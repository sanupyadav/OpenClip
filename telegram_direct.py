"""Send clips to Telegram with the user's own bot (self-host).

Free, no audit: a @BotFather token and a chat id (a private chat with the
bot, a group it was added to, or a channel it administers; a public channel
can be "@name"). The Bot API takes uploads up to 50 MB, a caption up to
1,024 characters. The token is write-only: it lives in a 0600 file next to
the jobs and never goes back to the browser.
"""
import os

import httpx

API = "https://api.telegram.org/bot{token}/{method}"
MAX_BYTES = 50 * 1024 * 1024
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


def send_video(token: str, chat_id: str, file_path: str, text: str) -> dict:
    size = os.path.getsize(file_path)
    if size > MAX_BYTES:
        raise TelegramError(f"The clip is {size / 1048576:.0f} MB; a Telegram bot can send 50 MB at most.")
    with open(file_path, "rb") as f:
        msg = _call(token, "sendVideo", timeout=httpx.Timeout(30, write=600, read=600),
                    data={"chat_id": chat_id, "caption": text, "supports_streaming": "true"},
                    files={"video": (os.path.basename(file_path), f, "video/mp4")})
    return {"messageId": msg.get("message_id"), "url": message_link(msg.get("chat") or {}, msg.get("message_id"))}
