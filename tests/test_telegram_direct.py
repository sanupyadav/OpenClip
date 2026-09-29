import asyncio
import json

import httpx
import pytest

import telegram_direct as tg


_REAL_CLIENT = httpx.Client  # before any test patches it, so _mock can run twice


def _mock(monkeypatch, handler):
    monkeypatch.setattr(tg.httpx, "Client",
                        lambda **kw: _REAL_CLIENT(transport=httpx.MockTransport(handler), **kw))


def test_send_video_posts_the_file_with_caption_and_links_the_message(monkeypatch, tmp_path):
    video = tmp_path / "clip.mp4"
    video.write_bytes(b"vid")
    seen = []

    def handler(req):
        seen.append(req)
        return httpx.Response(200, json={"ok": True, "result": {
            "message_id": 42, "chat": {"id": -1001234, "type": "channel", "username": "mychan"}}})

    _mock(monkeypatch, handler)
    out = tg.send_video("TOKEN", "@mychan", str(video), tg.caption("Title", "Desc"))
    assert out == {"messageId": 42, "url": "https://t.me/mychan/42"}
    body = seen[0].read()
    assert seen[0].url.path == "/botTOKEN/sendVideo"
    assert b"Title\n\nDesc" in body and b"@mychan" in body and b"vid" in body


def test_links_for_private_chats_and_errors_are_readable(monkeypatch, tmp_path):
    assert tg.message_link({"id": -1009876}, 5) == "https://t.me/c/9876/5"
    assert tg.message_link({"id": 111}, 5) is None
    assert len(tg.caption("t" * 2000, "d")) == 1024
    _mock(monkeypatch, lambda r: httpx.Response(401, json={"ok": False, "description": "Unauthorized"}))
    with pytest.raises(tg.TelegramError, match="Unauthorized"):
        tg.bot_name("bad")
    big = tmp_path / "big.mp4"  # over the limit and not a real video: cannot be compressed
    with open(big, "wb") as f:
        f.truncate(tg.MAX_BYTES + 1)
    with pytest.raises(tg.TelegramError, match="50 MB"):
        tg.send_video("t", "1", str(big), "")


def test_recent_chats_lists_each_chat_once(monkeypatch):
    _mock(monkeypatch, lambda r: httpx.Response(200, json={"ok": True, "result": [
        {"message": {"chat": {"id": 7, "type": "private", "first_name": "Sanup"}}},
        {"message": {"chat": {"id": 7, "type": "private", "first_name": "Sanup"}}},
        {"channel_post": {"chat": {"id": -1005, "type": "channel", "title": "Clips"}}},
    ]}))
    assert tg.recent_chats("t") == [{"id": "7", "title": "Sanup", "type": "private"},
                                    {"id": "-1005", "title": "Clips", "type": "channel"}]


app = pytest.importorskip("app")


def test_config_is_write_only_and_a_send_is_marked_in_the_gallery(monkeypatch, tmp_path):
    monkeypatch.setattr(app, "BILLING_ENABLED", False)
    monkeypatch.setattr(app, "OUTPUT_DIR", str(tmp_path))
    monkeypatch.setattr(app, "_TG_FILE", str(tmp_path / ".telegram.json"))
    monkeypatch.setattr(app, "_local_job_running", lambda name: False)
    monkeypatch.setattr(app._tg, "bot_name", lambda token: "clipbot")
    monkeypatch.setattr(app._tg, "chat_title", lambda token, chat: "My Channel")
    with pytest.raises(app.HTTPException, match="Settings"):
        asyncio.run(app.telegram_send(app.TelegramSendRequest(job_id="j", clip_index=0), None))
    st = asyncio.run(app.telegram_config(app.TelegramConfigRequest(bot_token="123:SECRET", chat_id="@mychan")))
    assert st["ready"] and st["bot"] == "clipbot" and "SECRET" not in json.dumps(st)
    assert oct((tmp_path / ".telegram.json").stat().st_mode & 0o777) == "0o600"

    job = tmp_path / "jobT"
    job.mkdir()
    (job / "clip_0.mp4").write_bytes(b"v")
    (job / "s_metadata.json").write_text(json.dumps({"shorts": [{"video_url": "/videos/jobT/clip_0.mp4"}]}))
    monkeypatch.setattr(app._tg, "send_video", lambda *a: {"messageId": 9, "url": "https://t.me/mychan/9"})
    out = asyncio.run(app.telegram_send(app.TelegramSendRequest(job_id="jobT", clip_index=0, title="T"), None))
    assert out["url"] == "https://t.me/mychan/9" and out["chat"] == "My Channel"
    assert asyncio.run(app.telegram_sends("jobT"))["sends"]["0"]["messageId"] == 9
    assert asyncio.run(app.list_local_videos())["jobs"][0]["videos"][0]["telegram"]["messageId"] == 9


def test_delete_treats_gone_as_done_and_explains_the_48h_rule(monkeypatch):
    _mock(monkeypatch, lambda r: httpx.Response(400, json={"ok": False, "description": "Bad Request: message to delete not found"}))
    assert tg.delete_message("t", "1", 5) is True
    _mock(monkeypatch, lambda r: httpx.Response(400, json={"ok": False, "description": "Bad Request: message can't be deleted"}))
    with pytest.raises(tg.TelegramError, match="48 hours"):
        tg.delete_message("t", "1", 5)


def test_unsend_deletes_the_message_and_the_mark(monkeypatch, tmp_path):
    monkeypatch.setattr(app, "BILLING_ENABLED", False)
    monkeypatch.setattr(app, "OUTPUT_DIR", str(tmp_path))
    monkeypatch.setattr(app, "_TG_FILE", str(tmp_path / ".telegram.json"))
    app._yt.save(app._TG_FILE, {"token": "T", "chat_id": "@now"})
    job = tmp_path / "jobD"
    job.mkdir()
    (job / "clip_0.mp4").write_bytes(b"v")
    monkeypatch.setattr(app._tg, "send_video", lambda *a: {"messageId": 7, "url": None})
    mark = asyncio.run(app.telegram_send(app.TelegramSendRequest(job_id="jobD", clip_index=0, input_filename="clip_0.mp4"), None))
    assert mark["chatId"] == "@now"
    app._yt.save(app._TG_FILE, {"token": "T", "chat_id": "@changed"})  # the saved chat, not today's, is used
    calls = []
    monkeypatch.setattr(app._tg, "delete_message", lambda token, chat, mid: calls.append((chat, mid)) or True)
    assert asyncio.run(app.telegram_unsend("jobD", 0))["deleted"] is True
    assert calls == [("@now", 7)] and asyncio.run(app.telegram_sends("jobD"))["sends"] == {}
    with pytest.raises(app.HTTPException):
        asyncio.run(app.telegram_unsend("jobD", 0))  # nothing left to delete
    # Too old for Telegram: the error comes back, forget=true drops the mark alone.
    asyncio.run(app.telegram_send(app.TelegramSendRequest(job_id="jobD", clip_index=0, input_filename="clip_0.mp4"), None))

    def too_old(*a):
        raise app._tg.TelegramError("only within 48 hours")
    monkeypatch.setattr(app._tg, "delete_message", too_old)
    with pytest.raises(app.HTTPException) as e:
        asyncio.run(app.telegram_unsend("jobD", 0))
    assert e.value.status_code == 409
    assert asyncio.run(app.telegram_unsend("jobD", 0, forget=True))["forgotten"] is True
    assert asyncio.run(app.telegram_sends("jobD"))["sends"] == {}


def test_a_clip_over_the_limit_is_sent_as_a_compressed_copy(monkeypatch, tmp_path):
    import shutil
    import subprocess
    if not shutil.which("ffmpeg"):
        pytest.skip("needs ffmpeg")
    clip = tmp_path / "clip.mp4"  # 6 s of noise at a high bitrate: ~3 MB
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "nullsrc=s=360x640:d=6,geq=random(1)*255:128:128",
                    "-f", "lavfi", "-i", "sine=d=6", "-c:v", "libx264", "-b:v", "4M", "-c:a", "aac", "-shortest",
                    str(clip)], check=True)
    before = clip.read_bytes()
    monkeypatch.setattr(tg, "MAX_BYTES", 1024 * 1024)       # pretend Telegram's limit is 1 MB
    monkeypatch.setattr(tg, "FIT_BYTES", 900 * 1024)
    monkeypatch.setattr(tg.shrink_to_fit, "__defaults__", (900 * 1024,))
    import ffmpeg_utils
    monkeypatch.setattr(ffmpeg_utils, "nvenc_available", lambda: False)
    import tempfile
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))  # so the copy's cleanup is checkable
    sizes = []

    def handler(req):
        sizes.append(len(req.read()))
        return httpx.Response(200, json={"ok": True, "result": {"message_id": 1, "chat": {"id": 5}}})
    _mock(monkeypatch, handler)
    out = tg.send_video("T", "5", str(clip), "c")
    assert out["compressedFromMb"] > out["sentMb"] and sizes[0] < 1024 * 1024
    assert clip.read_bytes() == before  # the original is untouched
    assert not list(tmp_path.glob("telegram_*"))
