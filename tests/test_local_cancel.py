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


def test_retry_requeues_a_failed_job_and_keeps_the_checkpoint(monkeypatch, tmp_path):
    monkeypatch.setattr(app, "BILLING_ENABLED", False)
    queued = []
    monkeypatch.setattr(app, "_enqueue_job", lambda jid, prio=2: queued.append(jid))
    (tmp_path / "x_clip_1.mp4").write_bytes(b"half")
    (tmp_path / ".transcript_checkpoint.json").write_text("{}")
    app.jobs["t-f"] = {"status": "failed", "logs": _log(), "cancelled": True,
                       "cmd": ["py", "-u", "main.py", "-u", "https://x"], "output_dir": str(tmp_path)}
    try:
        rows = asyncio.run(app.local_queue())["jobs"]
        assert any(r["job_id"] == "t-f" and r["status"] == "failed" for r in rows)
        asyncio.run(app.retry_local_job("t-f"))
        job = app.jobs["t-f"]
        assert job["status"] == "queued" and "cancelled" not in job and queued == ["t-f"]
        assert not (tmp_path / "x_clip_1.mp4").exists()
        assert (tmp_path / ".transcript_checkpoint.json").exists()
        with pytest.raises(app.HTTPException):
            asyncio.run(app.retry_local_job("t-f"))  # queued now, not failed
    finally:
        app.jobs.pop("t-f", None)


def test_retry_refuses_a_job_it_cannot_rerun(monkeypatch):
    monkeypatch.setattr(app, "BILLING_ENABLED", False)
    app.jobs["t-nocmd"] = {"status": "failed", "logs": _log()}  # recovered from disk
    try:
        with pytest.raises(app.HTTPException):
            asyncio.run(app.retry_local_job("t-nocmd"))
    finally:
        app.jobs.pop("t-nocmd", None)
