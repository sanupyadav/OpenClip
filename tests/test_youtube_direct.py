import asyncio
import json

import httpx
import pytest

import youtube_direct as yt


def test_metadata_cleans_and_tags_it_as_a_short():
    m = yt.metadata("<b>" + "x" * 150, "desc", ["#a", "b" * 600, "c"], "public")
    assert len(m["snippet"]["title"]) == 100 and "<" not in m["snippet"]["title"]
    assert m["snippet"]["description"].endswith("#Shorts")
    assert m["snippet"]["tags"] == ["a", "c"]  # the 600-char tag does not fit in 500
    s = yt.metadata("t", "d", [], "public", publish_at="2026-10-01T10:00:00Z")["status"]
    assert s["privacyStatus"] == "private" and s["publishAt"] == "2026-10-01T10:00:00Z"
    with pytest.raises(yt.YouTubeError):
        yt.metadata("t", "d", [], "friends")


def test_upload_is_one_resumable_session_then_the_bytes(monkeypatch, tmp_path):
    video = tmp_path / "clip.mp4"
    video.write_bytes(b"0123456789")
    seen = []

    def handler(req):
        seen.append(req)
        if req.method == "POST":
            return httpx.Response(200, headers={"Location": "https://upload.example/session"})
        return httpx.Response(201, json={"id": "vid123"})

    real = httpx.Client
    monkeypatch.setattr(yt.httpx, "Client", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    meta = yt.metadata("Title", "Desc", ["t"], "unlisted")
    assert yt.upload("tok", str(video), meta) == "vid123"
    post, put = seen
    assert post.url.params["uploadType"] == "resumable" and post.headers["X-Upload-Content-Length"] == "10"
    assert json.loads(post.content)["status"]["privacyStatus"] == "unlisted"
    assert str(put.url) == "https://upload.example/session" and put.read() == b"0123456789"


def test_google_errors_come_back_readable(monkeypatch):
    real = httpx.Client
    monkeypatch.setattr(yt.httpx, "Client", lambda **kw: real(transport=httpx.MockTransport(
        lambda r: httpx.Response(400, json={"error": "invalid_grant", "error_description": "Token has been expired"})), **kw))
    with pytest.raises(yt.YouTubeError, match="Token has been expired"):
        yt.access_token("id", "secret", "refresh")


app = pytest.importorskip("app")


@pytest.fixture
def ytapp(monkeypatch, tmp_path):
    monkeypatch.setattr(app, "BILLING_ENABLED", False)
    monkeypatch.setattr(app, "_YT_FILE", str(tmp_path / ".youtube.json"))
    monkeypatch.setattr(app, "_yt_states", {})
    return tmp_path


def test_client_is_saved_write_only_and_auth_needs_the_callback_path(ytapp):
    with pytest.raises(app.HTTPException):
        asyncio.run(app.youtube_set_client(app.YouTubeClientRequest(client_id="nope")))
    st = asyncio.run(app.youtube_set_client(app.YouTubeClientRequest(
        client_id="123.apps.googleusercontent.com", client_secret="shh")))
    assert st["configured"] and "shh" not in json.dumps(st)
    assert oct((ytapp / ".youtube.json").stat().st_mode & 0o777) == "0o600"
    with pytest.raises(app.HTTPException):
        asyncio.run(app.youtube_auth(app.YouTubeAuthRequest(redirect_uri="https://evil.example/x")))
    url = asyncio.run(app.youtube_auth(app.YouTubeAuthRequest(
        redirect_uri="https://x.trycloudflare.com/api/youtube/callback")))["url"]
    assert "access_type=offline" in url and len(app._yt_states) == 1


def test_callback_with_an_unknown_state_is_refused(ytapp):
    resp = asyncio.run(app.youtube_callback(state="forged", code="c"))
    assert resp.status_code == 400 and b"expired" in resp.body


def test_upload_needs_a_connection_and_stays_inside_the_job_dir(ytapp, monkeypatch):
    req = app.YouTubeUploadRequest(job_id="j1", clip_index=0, input_filename="../../etc/passwd")
    with pytest.raises(app.HTTPException, match="Connect YouTube"):
        asyncio.run(app.youtube_upload(req, None))
    yt.save(app._YT_FILE, {"client_id": "i", "client_secret": "s", "refresh_token": "r"})

    async def no_restore(*a):
        return True
    monkeypatch.setattr(app, "_ensure_job_files", no_restore)
    app.jobs["j1"] = {"result": {"clips": [{"video_url": "/videos/j1/clip.mp4"}]}}
    try:
        with pytest.raises(app.HTTPException) as e:
            asyncio.run(app.youtube_upload(req, None))
        assert e.value.status_code == 404  # basename "passwd" is not in output/j1
    finally:
        app.jobs.pop("j1", None)
