"""YouTube Studio with no Gemini key: the local LLM writes the titles and
the thumbnails are the user's frame + PIL text."""
import os

import pytest
from PIL import Image

thumbnail = pytest.importorskip("thumbnail")
import llm_backend  # noqa: E402


def test_titles_and_frame_thumbnails_without_a_gemini_key(monkeypatch, tmp_path):
    prompts = []

    def fake_json(prompt, schema, model=None):
        prompts.append(prompt)
        if schema is thumbnail._Brainstorm:
            return {"transcript_summary": "s", "candidates": ["A", "B"]}, None
        return {"titles": ["Best title"], "thumbnail_texts": ["WOW"], "recommended": [{"index": 0, "reason": "r"}]}, None
    monkeypatch.setattr(llm_backend, "generate_json", fake_json)
    monkeypatch.setattr(thumbnail, "_frame_parts", lambda *a, **k: pytest.fail("frames are Gemini-only"))
    out = thumbnail.analyze_video_for_titles(None, "unused.mp4", {"text": "x" * 20000, "language": "hi", "segments": []})
    assert out["titles"] == ["Best title"] and out["thumbnail_texts"] == ["WOW"]
    assert len(prompts[0]) < 20000  # the transcript is cut for a small local context

    frame = tmp_path / "frame.jpg"
    Image.new("RGB", (1920, 1080), "navy").save(frame)
    monkeypatch.chdir(tmp_path)
    thumbs = thumbnail.generate_thumbnail(None, "my title here", "s1", count=2,
                                          frame_reference={"path": str(frame)}, thumbnail_text_hint="big win")
    assert [t["text"] for t in thumbs] == ["BIG WIN", "BIG WIN"]
    path = tmp_path / "output" / "thumbnails" / "s1" / os.path.basename(thumbs[0]["url"])
    assert Image.open(path).size == (1280, 720)
    with pytest.raises(RuntimeError, match="pick a frame"):
        thumbnail.generate_thumbnail(None, "t", "s2")
