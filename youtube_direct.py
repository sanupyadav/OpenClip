"""Direct YouTube upload with the user's own Google OAuth client (self-host).

No Upload-Post and no Google SDK: plain OAuth 2.0 + the YouTube Data API v3
resumable upload over httpx. Free: the API's default quota is 10,000 units a
day and an upload costs 1,600 (~6 a day). Google keeps every upload from an
API project it has not audited (any project created after 28-jul-2020) as
Private until the project passes the free "YouTube API Services" audit; the
video can still be made public by hand in YouTube Studio.

The client secret and the refresh token are write-only: they live in a 0600
file next to the jobs and never go back to the browser.
"""
import json
import os
import urllib.parse

import httpx

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos"
CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels"
VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos"
# upload to post, readonly to show which channel is connected, force-ssl to
# delete a video (logins made before it was added cannot delete).
SCOPES = ("https://www.googleapis.com/auth/youtube.upload "
          "https://www.googleapis.com/auth/youtube.readonly "
          "https://www.googleapis.com/auth/youtube.force-ssl")
DELETE_SCOPE = "youtube.force-ssl"
PRIVACY = ("private", "unlisted", "public")
CALLBACK_PATH = "/api/youtube/callback"


class YouTubeError(Exception):
    """A Google answer the user should read as-is (bad client, quota, ...)."""


def _google_error(resp) -> str:
    try:
        body = resp.json()
    except ValueError:
        return f"HTTP {resp.status_code}: {resp.text[:200]}"
    err = body.get("error")
    if isinstance(err, dict):  # Data API: {"error": {"message": ...}}
        return err.get("message") or str(err)[:200]
    # OAuth endpoints: {"error": "invalid_grant", "error_description": ...}
    return body.get("error_description") or str(err or body)[:200]


def load(path: str) -> dict:
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save(path: str, data: dict):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(data, f)


def auth_url(client_id: str, redirect_uri: str, state: str) -> str:
    # offline + consent: Google only hands out a refresh token on a consent
    # screen, and without one every upload would need a fresh login.
    # select_account: pick the channel's Google account, not the browser's default.
    return AUTH_URL + "?" + urllib.parse.urlencode({
        "client_id": client_id, "redirect_uri": redirect_uri, "response_type": "code",
        "scope": SCOPES, "access_type": "offline", "prompt": "select_account consent",
        "include_granted_scopes": "true", "state": state,
    })


def exchange_code(client_id, client_secret, code, redirect_uri) -> dict:
    with httpx.Client(timeout=30) as c:
        r = c.post(TOKEN_URL, data={
            "code": code, "client_id": client_id, "client_secret": client_secret,
            "redirect_uri": redirect_uri, "grant_type": "authorization_code"})
    if r.status_code != 200:
        raise YouTubeError(_google_error(r))
    return r.json()


def access_token(client_id, client_secret, refresh_token) -> str:
    with httpx.Client(timeout=30) as c:
        r = c.post(TOKEN_URL, data={
            "client_id": client_id, "client_secret": client_secret,
            "refresh_token": refresh_token, "grant_type": "refresh_token"})
    if r.status_code != 200:
        raise YouTubeError(f"Google refused the saved login ({_google_error(r)}). Connect YouTube again.")
    return r.json()["access_token"]


def channel_title(token: str):
    with httpx.Client(timeout=30) as c:
        r = c.get(CHANNELS_URL, params={"part": "snippet", "mine": "true"},
                  headers={"Authorization": f"Bearer {token}"})
    items = r.json().get("items") if r.status_code == 200 else None
    return items[0]["snippet"]["title"] if items else None


def revoke(token: str):
    try:
        with httpx.Client(timeout=15) as c:
            c.post(REVOKE_URL, params={"token": token})
    except httpx.HTTPError:
        pass  # disconnecting locally is what matters


def credit_block(source: dict) -> str:
    """Credit to the original video, appended to every clip's YouTube
    description (main.py). Empty for an upload with no source link."""
    if not (source or {}).get("url"):
        return ""
    by = source.get("channel") or "the original creator"
    lines = [f"🎬 Credit: {source.get('title') or 'Original video'} by {by}",
             f"🔗 Full video: {source['url']}"]
    if source.get("channel_url"):
        lines.append(f"📺 Channel: {source['channel_url']}")
    lines.append(f"All rights to the original content belong to {by}.")
    return "\n".join(lines)


def youtube_description(clip: dict, source: dict) -> str:
    text = (clip.get("video_description_for_youtube") or clip.get("video_description_for_instagram")
            or clip.get("video_description_for_tiktok") or "").strip()
    credit = credit_block(source)
    return f"{text}\n\n{credit}".strip() if credit else text


def _clean(text: str) -> str:
    # The Data API rejects '<' and '>' in titles and descriptions.
    return (text or "").replace("<", "").replace(">", "").strip()


def metadata(title, description, tags, privacy, publish_at=None) -> dict:
    if privacy not in PRIVACY:
        raise YouTubeError(f"privacy must be one of {', '.join(PRIVACY)}")
    title = _clean(title)[:100] or "Short"
    description = _clean(description)
    if "#shorts" not in (title + " " + description).lower():
        description = (description + "\n\n#Shorts").strip()
    kept, used = [], 0
    for t in tags or []:  # YouTube caps the tags at 500 characters in total
        t = _clean(t).lstrip("#")
        if t and used + len(t) + 1 <= 500:
            kept.append(t)
            used += len(t) + 1
    status = {"privacyStatus": privacy, "selfDeclaredMadeForKids": False}
    if publish_at:  # scheduled: YouTube publishes it then; it must be private until
        status.update(privacyStatus="private", publishAt=publish_at)
    return {"snippet": {"title": title, "description": description[:5000],
                        "tags": kept, "categoryId": "22"},
            "status": status}


def upload(token: str, file_path: str, meta: dict) -> str:
    """Resumable upload: one POST for the session, one PUT with the bytes
    (streamed from disk). Returns the new video id."""
    size = os.path.getsize(file_path)
    with httpx.Client(timeout=httpx.Timeout(30, write=900, read=900)) as c:
        r = c.post(UPLOAD_URL, params={"uploadType": "resumable", "part": "snippet,status"},
                   headers={"Authorization": f"Bearer {token}",
                            "Content-Type": "application/json; charset=UTF-8",
                            "X-Upload-Content-Type": "video/mp4",
                            "X-Upload-Content-Length": str(size)},
                   content=json.dumps(meta))
        if r.status_code != 200 or not r.headers.get("location"):
            raise YouTubeError(_google_error(r))
        with open(file_path, "rb") as f:
            put = c.put(r.headers["location"], content=f,
                        headers={"Content-Type": "video/mp4", "Content-Length": str(size)})
    if put.status_code not in (200, 201):
        raise YouTubeError(_google_error(put))
    return put.json()["id"]


def delete_video(token: str, video_id: str):
    with httpx.Client(timeout=30) as c:
        r = c.delete(VIDEOS_URL, params={"id": video_id}, headers={"Authorization": f"Bearer {token}"})
    if r.status_code in (204, 404):  # 404: already deleted in YouTube Studio
        return
    msg = _google_error(r)
    if "insufficient" in msg.lower():
        msg = "this login can only upload. Reconnect YouTube in Settings to allow deleting."
    raise YouTubeError(msg)


def video_statuses(token: str, video_ids) -> dict:
    """{video id: {"privacy", "publishAt"}} as YouTube has them now (1 quota
    unit per 50 ids). An id missing from the answer was deleted."""
    out, ids = {}, list(video_ids)
    with httpx.Client(timeout=30) as c:
        for i in range(0, len(ids), 50):
            r = c.get(VIDEOS_URL, params={"part": "status", "id": ",".join(ids[i:i + 50])},
                      headers={"Authorization": f"Bearer {token}"})
            if r.status_code != 200:
                raise YouTubeError(_google_error(r))
            for v in r.json().get("items") or []:
                s = v.get("status") or {}
                out[v["id"]] = {"privacy": s.get("privacyStatus"), "publishAt": s.get("publishAt")}
    return out
