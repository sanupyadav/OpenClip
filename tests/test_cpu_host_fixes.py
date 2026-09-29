import gemini_worker


def test_object_followed_by_more_json_keeps_the_first():
    text = '{"shorts": [{"start": 1}]}\n{"shorts": []}'
    assert gemini_worker._parse_json_response_text(text) == {"shorts": [{"start": 1}]}


def test_stray_trailing_brace():
    assert gemini_worker._parse_json_response_text('```json\n{"a": 1}}\n```') == {"a": 1}


def test_prose_with_braces_before_the_object():
    text = 'Rank: {w2} beats {w0}.\n```json\n{"windows": [{"id": "w2"}]}\n```\nDone }'
    assert gemini_worker._parse_json_response_text(text) == {"windows": [{"id": "w2"}]}


def test_x264_preset_override(monkeypatch):
    import ffmpeg_utils
    monkeypatch.setenv("FFMPEG_ENCODER", "x264")
    monkeypatch.setenv("X264_PRESET", "veryfast")
    args = ffmpeg_utils.video_encode_args(ffmpeg_utils.QUALITY)
    assert args[args.index("-preset") + 1] == "veryfast" and "-crf" in args
    monkeypatch.delenv("X264_PRESET")
    args = ffmpeg_utils.video_encode_args(ffmpeg_utils.QUALITY)
    assert args[args.index("-preset") + 1] == "medium"
