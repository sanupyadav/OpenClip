"""Hindi transcripts in Roman script ("Hinglish"), the way people type Hindi.

Whisper writes Hindi in Devanagari, so the subtitles, hooks and titles of a
Hindi video came out in Devanagari. By default (HINGLISH=1) a Hindi
transcript is romanized right after transcription, word by word with the
timings untouched: "आज का माइनक्राफ्ट दिन" -> "aaj ka Minecraft din". Every
later stage reads the romanized words, and prompt_language() tells the
copywriting prompts to write Hinglish instead of Devanagari. HINGLISH=0
keeps Devanagari.

The romanizing is one LLM call per ~250 distinct words (the model that
picks the clips), with a small rule-based transliterator as the fallback
when the model is unavailable or answers the wrong count, so no Devanagari
is left behind either way.
"""
import os
import re
from typing import Callable, List, Optional

from pydantic import BaseModel

DEVANAGARI = re.compile(r"[ऀ-ॿ]")
BATCH = 250

PROMPT = """Transliterate each Hindi word below into Hinglish: Hindi written in Roman
letters the way Indians type it on WhatsApp and YouTube.
Examples: हैं -> hain, क्या -> kya, दोस्तों -> doston, नहीं -> nahi, बहुत -> bahut,
ज़्यादा -> zyada, पैसे -> paise. English words written in Devanagari go back to their
normal English spelling: माइनक्राफ्ट -> Minecraft, सब्सक्राइब -> subscribe, जॉब -> job.
Keep punctuation, and write the danda । as a full stop.
Return exactly {n} items, in the same order, one per input word, as a JSON object
of this exact shape and nothing else: {{"words": ["aaj", "ka", "Minecraft"]}}

WORDS (JSON): {words}
"""


class Romanized(BaseModel):
    words: List[str]


def enabled() -> bool:
    return os.environ.get("HINGLISH", "1").strip().lower() not in ("0", "false", "no", "off")


def wanted(transcript: dict) -> bool:
    return bool(transcript) and transcript.get("language") == "hi" and enabled() \
        and transcript.get("script") != "latin"


def prompt_language(transcript: Optional[dict]) -> str:
    """The TRANSCRIPT_LANGUAGE the copy prompts get: 'hi' there makes the
    model write Devanagari, so a romanized transcript is named explicitly."""
    language = str((transcript or {}).get("language") or "unknown")
    if (transcript or {}).get("script") == "latin" and language == "hi":
        return ("Hinglish (Hindi written in Roman/Latin letters as people type it, "
                "e.g. 'aaj ka din kamaal tha'; never Devanagari)")
    return language


# --- rule-based fallback -----------------------------------------------------
_VOWELS = {"अ": "a", "आ": "aa", "इ": "i", "ई": "ee", "उ": "u", "ऊ": "oo", "ऋ": "ri", "ए": "e",
           "ऐ": "ai", "ओ": "o", "औ": "au", "ऑ": "o", "ॲ": "e"}
_MATRAS = {"ा": "aa", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo", "ृ": "ri", "े": "e", "ै": "ai",
           "ो": "o", "ौ": "au", "ॉ": "o", "ॅ": "e"}
_CONSONANTS = {"क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n", "च": "ch", "छ": "chh", "ज": "j",
               "झ": "jh", "ञ": "n", "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n", "त": "t",
               "थ": "th", "द": "d", "ध": "dh", "न": "n", "प": "p", "फ": "ph", "ब": "b", "भ": "bh",
               "म": "m", "य": "y", "र": "r", "ल": "l", "व": "v", "श": "sh", "ष": "sh", "स": "s",
               "ह": "h", "ळ": "l", "क़": "q", "ख़": "kh", "ग़": "gh", "ज़": "z", "ड़": "d", "ढ़": "rh",
               "फ़": "f", "य़": "y"}
_SIGNS = {"ं": "n", "ँ": "n", "ः": "h", "्": "", "़": "", "।": ".", "॥": "."}
_DIGITS = {chr(0x966 + i): str(i) for i in range(10)}


def rule_romanize(word: str) -> str:
    """Plain Devanagari -> Latin with the inherent 'a' and word-final schwa
    deletion. Rougher than the model ("maainakraapht"), but never boxes."""
    out, i, chars = [], 0, list(word)
    while i < len(chars):
        ch = chars[i]
        nxt = chars[i + 1] if i + 1 < len(chars) else ""
        if ch + nxt in _CONSONANTS:  # precomposed nukta forms written as two codepoints
            ch, i = ch + nxt, i + 1
            nxt = chars[i + 1] if i + 1 < len(chars) else ""
        if ch in _CONSONANTS:
            out.append(_CONSONANTS[ch])
            # The inherent 'a', unless a vowel sign or virama follows, or the
            # word ends here (schwa deletion: "kaam", not "kaama").
            if nxt and nxt not in _MATRAS and nxt != "्":
                out.append("a")
        elif ch in _MATRAS:
            out.append(_MATRAS[ch])
        elif ch in _VOWELS:
            out.append(_VOWELS[ch])
        elif ch in _SIGNS:
            out.append(_SIGNS[ch])
        elif ch in _DIGITS:
            out.append(_DIGITS[ch])
        else:
            out.append(ch)
        i += 1
    text = "".join(out)
    # How Hinglish is typed: a long vowel at the end of a word is written
    # short ("ka", "meri", "ki", "hu"), inside it stays ("baat", "paani").
    return re.sub(r"(aa|ee|oo)\b", lambda m: m.group(1)[0].replace("e", "i").replace("o", "u"), text)


# --- transcript --------------------------------------------------------------
def _romanize_batch(tokens: List[str], ask: Optional[Callable]) -> List[str]:
    if ask:
        try:
            import json
            got = ask(PROMPT.format(n=len(tokens), words=json.dumps(tokens, ensure_ascii=False)), Romanized)
            words = [str(w).strip() for w in (got or {}).get("words") or []]
            if len(words) == len(tokens) and not any(DEVANAGARI.search(w) or not w for w in words):
                return words
            print(f"⚠️ [Hinglish] model returned {len(words)} words for {len(tokens)}: "
                  f"rule-based for this batch")
        except Exception as e:
            print(f"⚠️ [Hinglish] model call failed ({type(e).__name__}: {e}): rule-based for this batch")
    return [rule_romanize(t) for t in tokens]


def romanize_transcript(transcript: dict, ask: Optional[Callable] = None) -> dict:
    """Romanize every Devanagari word in place (segment text and word list;
    timings untouched) and mark the transcript script='latin'. `ask(prompt,
    schema) -> dict` is the model call; None uses the rule-based fallback."""
    tokens = []
    seen = set()
    for seg in transcript.get("segments") or []:
        for tok in (seg.get("text") or "").split() + [(w.get("word") or "").strip() for w in seg.get("words") or []]:
            if tok and DEVANAGARI.search(tok) and tok not in seen:
                seen.add(tok)
                tokens.append(tok)
    # Batches in parallel: a hosted model answers one call in seconds to
    # minutes regardless of its size, so an hour of speech does not queue up.
    from concurrent.futures import ThreadPoolExecutor
    batches = [tokens[i:i + BATCH] for i in range(0, len(tokens), BATCH)]
    mapping = {}
    with ThreadPoolExecutor(max_workers=min(4, len(batches) or 1)) as pool:
        for batch, words in zip(batches, pool.map(lambda b: _romanize_batch(b, ask), batches)):
            mapping.update(zip(batch, words))

    def convert(tok: str) -> str:
        if not DEVANAGARI.search(tok):
            return tok
        return mapping.get(tok) or rule_romanize(tok)

    for seg in transcript.get("segments") or []:
        seg["text"] = " ".join(convert(t) for t in (seg.get("text") or "").split())
        for w in seg.get("words") or []:
            raw = w.get("word") or ""
            lead = raw[:len(raw) - len(raw.lstrip())]  # the leading space marks a word start
            w["word"] = lead + convert(raw.strip())
    transcript["script"] = "latin"
    print(f"🔤 Hinglish: romanized {len(tokens)} distinct Hindi word(s) (HINGLISH=0 keeps Devanagari)")
    return transcript
