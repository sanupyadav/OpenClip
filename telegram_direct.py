"""Send clips to Telegram with the user's own bot (self-host).

Free, no audit: a @BotFather token and a chat id (a private chat with the
bot, a group it was added to, or a channel it administers; a public channel
can be "@name"). The Bot API takes uploads up to 50 MB (a bigger clip is
sent as a compressed copy, see shrink_to_fit), a caption up to 1,024
characters. The token is write-only: it lives in a 0600 file next to
the jobs and never goes back to the browser.
"""
import os
import subprocess
import tempfile

import httpx

API = "https://api.telegram.org/bot{token}/{method}"
MAX_BYTES = 50 * 1024 * 1024
# A clip over the limit is re-encoded to fit, only for Telegram (the original
# stays as it is): aim under 49 MB so the container overhead never tips it over.
FIT_BYTES = 49 * 1024 * 1024
AUDIO_KBPS = 128
MAX_CAPTION = 1024


class TelegramError(Exception):
    """A Telegram answer the user should read as-is (bad token, no rights, ...)."""


def _call(token: str, method: str, timeout=30, **kwargs) -> dict:
    try:
        with httpx.Client(timeout=timeout) as c:
            r = c.post(API.format(token=token, method=method), **kwargs)
        body = r.json()
    except (httpx.HTTPError, ValueError) as e:
        raise TelegramError(f"Could not reach Telegram: {e}")
    if not body.get("ok"):
        raise TelegramError(body.get("description") or f"HTTP {r.status_code}")
    return body["result"]


def bot_name(token: str) -> str:
    me = _call(token, "getMe")
    return me.get("username") or me.get("first_name") or "bot"


def recent_chats(token: str) -> list:
    """Chats the bot has seen lately (getUpdates), so the user can pick one
    instead of hunting for an id. Empty until someone messages the bot or
    adds it to a group/channel."""
    seen = {}
    for u in _call(token, "getUpdates", data={"limit": 100}):
        for key in ("message", "channel_post", "my_chat_member", "edited_message"):
            chat = (u.get(key) or {}).get("chat")
            if chat and chat.get("id") is not None:
                name = chat.get("title") or " ".join(
                    x for x in (chat.get("first_name"), chat.get("last_name")) if x) or chat.get("username")
                seen[chat["id"]] = {"id": str(chat["id"]), "title": name or str(chat["id"]),
                                    "type": chat.get("type", "")}
    return list(seen.values())


def normalize_chat_id(chat_id: str) -> str:
    """What people paste: a group id missing its minus ("1003947782883"),
    spaces, a t.me/name link. Groups and channels are -100..., users are
    positive, public chats can be @name."""
    c = (chat_id or "").strip().replace(" ", "")
    for prefix in ("https://t.me/", "http://t.me/", "t.me/"):
        if c.startswith(prefix) and not c[len(prefix):].startswith(("+", "c/", "joinchat")):
            c = "@" + c[len(prefix):].split("/")[0]
    if c.isdigit() and c.startswith("100") and len(c) >= 13:
        c = "-" + c
    return c


def chat_title(token: str, chat_id: str) -> str:
    chat = _call(token, "getChat", data={"chat_id": chat_id})
    return chat.get("title") or chat.get("first_name") or chat.get("username") or str(chat_id)


def caption(title: str, description: str) -> str:
    text = "\n\n".join(x.strip() for x in (title or "", description or "") if x and x.strip())
    return text[:MAX_CAPTION]


def message_link(chat: dict, message_id: int):
    """t.me link to the sent video: public chats by name, private groups and
    channels by their -100 id (opens for members). A private chat has none."""
    if chat.get("username"):
        return f"https://t.me/{chat['username']}/{message_id}"
    cid = str(chat.get("id", ""))
    if cid.startswith("-100"):
        return f"https://t.me/c/{cid[4:]}/{message_id}"
    return None


def delete_message(token: str, chat_id: str, message_id: int) -> bool:
    """Delete a message the bot sent. Telegram only allows it for messages
    under 48 hours old. True also when it is already gone (deleted by hand)."""
    try:
        _call(token, "deleteMessage", data={"chat_id": chat_id, "message_id": message_id})
    except TelegramError as e:
        text = str(e).lower()
        if "not found" in text:
            return True
        if "can't be deleted" in text or "cannot be deleted" in text:
            raise TelegramError("Telegram lets a bot delete a message only within 48 hours of sending it "
                                "(or it lacks the delete right in that group/channel). Delete it in the app.")
        raise
    return True


def _duration(path: str) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "default=nw=1:nk=1", path], capture_output=True, text=True, timeout=60)
    try:
        return float(out.stdout.strip())
    except ValueError:
        raise TelegramError("The clip is over 50 MB and could not be read to compress it.")


def shrink_to_fit(path: str, limit: int = FIT_BYTES) -> str:
    """A copy of the clip re-encoded to fit under `limit` (same resolution,
    lower bitrate), in a temp file the caller deletes. Tries a lower bitrate
    once more if the first pass lands over."""
    import ffmpeg_utils
    seconds = _duration(path)
    fd, out = tempfile.mkstemp(suffix=".mp4", prefix="telegram_")
    os.close(fd)
    target = limit * 0.96  # headroom for the mp4 container
    for _ in range(2):
        kbps = max(300, int(target * 8 / seconds / 1000) - AUDIO_KBPS)
        rate = ["-b:v", f"{kbps}k", "-maxrate", f"{kbps}k", "-bufsize", f"{2 * kbps}k"]
        if ffmpeg_utils.nvenc_available():
            video = ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr"] + rate
        else:
            video = ["-c:v", "libx264", "-preset", "veryfast"] + rate
        r = subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", path, *video, "-pix_fmt", "yuv420p",
                            "-c:a", "aac", "-b:a", f"{AUDIO_KBPS}k", "-movflags", "+faststart", out],
                           capture_output=True, text=True)
        if r.returncode == 0 and 0 < os.path.getsize(out) <= limit:
            return out
        target *= 0.85
    os.remove(out)
    raise TelegramError("The clip is over 50 MB and could not be compressed under Telegram's limit.")


def send_video(token: str, chat_id: str, file_path: str, text: str) -> dict:
    """Send the clip; one over 50 MB goes as a compressed copy (the file on
    disk is untouched). The result says when that happened."""
    size = os.path.getsize(file_path)
    send_path, extra = file_path, {}
    if size > MAX_BYTES:
        send_path = shrink_to_fit(file_path)
        extra = {"compressedFromMb": round(size / 1048576, 1),
                 "sentMb": round(os.path.getsize(send_path) / 1048576, 1)}
    try:
        with open(send_path, "rb") as f:
            msg = _call(token, "sendVideo", timeout=httpx.Timeout(30, write=600, read=600),
                        data={"chat_id": chat_id, "caption": text, "supports_streaming": "true"},
                        files={"video": (os.path.basename(file_path), f, "video/mp4")})
    finally:
        if send_path != file_path:
            os.remove(send_path)
    return {"messageId": msg.get("message_id"),
            "url": message_link(msg.get("chat") or {}, msg.get("message_id")), **extra}
