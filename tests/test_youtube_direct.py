import asyncio
import json
import os

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


def test_upload_from_the_gallery_records_the_mark(ytapp, monkeypatch):
    # A job the server no longer holds in memory: the clip comes from the metadata on disk.
    monkeypatch.setattr(app, "OUTPUT_DIR", str(ytapp))
    monkeypatch.setattr(app, "_local_job_running", lambda name: False)
    job = ytapp / "jobX"
    job.mkdir()
    (job / "clip_0.mp4").write_bytes(b"v")
    (job / "src_metadata.json").write_text(json.dumps(
        {"shorts": [{"video_url": "/videos/jobX/clip_0.mp4", "video_title_for_youtube_short": "T"}]}))
    yt.save(app._YT_FILE, {"client_id": "i", "client_secret": "s", "refresh_token": "r"})
    monkeypatch.setattr(app, "_yt_upload_blocking", lambda cfg, path, meta: "abc123")
    out = asyncio.run(app.youtube_upload(app.YouTubeUploadRequest(job_id="jobX", clip_index=0, title="T"), None))
    assert out["url"] == "https://youtube.com/shorts/abc123"
    assert asyncio.run(app.youtube_uploads("jobX"))["uploads"]["0"]["videoId"] == "abc123"
    gallery = asyncio.run(app.list_local_videos())["jobs"][0]["videos"][0]
    assert gallery["youtube"]["videoId"] == "abc123"
    with pytest.raises(app.HTTPException):
        asyncio.run(app.youtube_uploads("../etc"))


def test_auto_schedule_spaces_the_clips_and_the_tab_deletes_them(ytapp, monkeypatch):
    monkeypatch.setattr(app, "OUTPUT_DIR", str(ytapp))
    monkeypatch.setattr(app, "_local_job_running", lambda name: False)
    job = ytapp / "jobS"
    job.mkdir()
    for i in range(3):
        (job / f"c{i}.mp4").write_bytes(b"v")
    (job / "s_metadata.json").write_text(json.dumps({"shorts": [
        {"video_url": f"/videos/jobS/c{i}.mp4", "video_title_for_youtube_short": f"T{i}"} for i in range(3)]}))
    app._yt_set_mark(str(job), 1, {"videoId": "old", "url": "u"})  # uploaded by hand, before marks had a status
    yt.save(app._YT_FILE, {"client_id": "i", "client_secret": "s", "refresh_token": "r",
                           "auto_schedule": True, "interval_hours": 3})
    uploads, quota = [], [True]

    def fake_upload(cfg, path, meta):
        if quota.pop() if quota else False:
            raise yt.YouTubeError("The request cannot be completed because you have exceeded your quota.")
        uploads.append((os.path.basename(path), meta["status"]["publishAt"]))
        return f"v{len(uploads)}"
    monkeypatch.setattr(app, "_yt_upload_blocking", fake_upload)
    real_sleep = asyncio.sleep

    async def no_wait(s):
        await real_sleep(0)
    monkeypatch.setattr(app.asyncio, "sleep", no_wait)

    async def finish():
        await app._youtube_auto_schedule("jobS", {"status": "completed"})
        await app._yt_worker
    asyncio.run(finish())
    assert [u[0] for u in uploads] == ["c0.mp4", "c2.mp4"]  # the quota error retried; clip 1 was already up
    rows = {r["clip_index"]: r for r in asyncio.run(app.youtube_all_uploads())["uploads"]}
    assert rows[0]["status"] == rows[2]["status"] == "uploaded" and rows[1]["status"] == "uploaded"
    assert abs(rows[2]["slot"] - rows[0]["slot"] - 3 * 3600) < 5 and "error" not in rows[0]

    deleted = []
    monkeypatch.setattr(app._yt, "access_token", lambda *a: "tok")
    monkeypatch.setattr(app._yt, "delete_video", lambda tok, vid: deleted.append(vid))
    assert asyncio.run(app.youtube_delete_upload("jobS", 0))["deleted"]
    assert deleted == ["v1"] and "0" not in asyncio.run(app.youtube_uploads("jobS"))["uploads"]


def test_delete_explains_an_old_login_and_treats_gone_as_done(monkeypatch):
    real = httpx.Client
    answers = [httpx.Response(404), httpx.Response(403, json={"error": {"message": "Request had insufficient authentication scopes."}})]
    monkeypatch.setattr(yt.httpx, "Client", lambda **kw: real(transport=httpx.MockTransport(lambda r: answers.pop()), **kw))
    with pytest.raises(yt.YouTubeError, match="Reconnect"):
        yt.delete_video("t", "v")
    yt.delete_video("t", "v")  # 404: already deleted


def test_check_reads_the_live_state_of_each_video(ytapp, monkeypatch):
    monkeypatch.setattr(app, "OUTPUT_DIR", str(ytapp))
    job = ytapp / "jobC"
    job.mkdir()
    app._yt_set_mark(str(job), 0, {"status": "uploaded", "videoId": "a", "publishAt": "2026-10-02T10:00:00Z"})
    app._yt_set_mark(str(job), 1, {"status": "uploaded", "videoId": "b"})
    app._yt_set_mark(str(job), 2, {"status": "queued", "slot": 1})
    yt.save(app._YT_FILE, {"client_id": "i", "client_secret": "s", "refresh_token": "r"})
    monkeypatch.setattr(app._yt, "access_token", lambda *a: "tok")
    monkeypatch.setattr(app._yt, "video_statuses", lambda tok, ids: {
        "a": {"privacy": "private", "publishAt": "2026-10-02T10:00:00Z"}})
    rows = {r["clip_index"]: r for r in asyncio.run(app.youtube_check_uploads())["uploads"]}
    assert rows[0]["live"] == "scheduled" and rows[1]["live"] == "deleted" and "live" not in rows[2]


def test_source_duration_is_self_host_only_and_validates_the_link(ytapp, monkeypatch):
    async def probe(url):
        return {"duration": 754}
    monkeypatch.setattr(app, "_probe_youtube_quality", probe)
    assert asyncio.run(app.source_duration("https://www.youtube.com/watch?v=dQw4w9WgXcQ"))["duration"] == 754
    with pytest.raises(app.HTTPException):
        asyncio.run(app.source_duration("http://127.0.0.1/x"))
    monkeypatch.setattr(app, "BILLING_ENABLED", True)
    with pytest.raises(app.HTTPException):
        asyncio.run(app.source_duration("https://www.youtube.com/watch?v=dQw4w9WgXcQ"))
