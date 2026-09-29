import asyncio
import os
import subprocess
import time

import pytest

app = pytest.importorskip("app")


def _log():
    return app._TimedLog(["queued"])


def test_cancel_running_job_kills_the_whole_process_group(monkeypatch):
    monkeypatch.setattr(app, "BILLING_ENABLED", False)
    # Parent + child, like main.py spawning ffmpeg.
    proc = subprocess.Popen(["sh", "-c", "sleep 60 & wait"], start_new_session=True)
    app.jobs["t-run"] = {"status": "processing", "logs": _log(), "_proc": proc}
    try:
        asyncio.run(app.cancel_local_job("t-run"))
        for _ in range(50):
            if proc.poll() is not None:
                break
            time.sleep(0.1)
        assert proc.poll() is not None
        # No stray child left in that process group (signal 0 = existence check).
        for _ in range(50):
            try:
                os.killpg(proc.pid, 0)
            except ProcessLookupError:
                break
            time.sleep(0.1)
        with pytest.raises(ProcessLookupError):
            os.killpg(proc.pid, 0)
        assert app.jobs["t-run"]["cancelled"] is True
        assert not app._should_auto_retry({**app.jobs["t-run"], "status": "failed", "cmd": ["x"]})
    finally:
        app.jobs.pop("t-run", None)


def test_cancel_queued_job_marks_it_stopped(monkeypatch):
    monkeypatch.setattr(app, "BILLING_ENABLED", False)
    app.jobs["t-q"] = {"status": "queued", "logs": _log()}
    try:
        asyncio.run(app.cancel_local_job("t-q"))
        assert app.jobs["t-q"]["status"] == "failed"
        assert app.jobs["t-q"]["logs"][-1] == "⏹️ Stopped by you."
        with pytest.raises(app.HTTPException):
            asyncio.run(app.cancel_local_job("t-q"))  # already finished
    finally:
        app.jobs.pop("t-q", None)
