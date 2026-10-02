"""Background music: the in-place mix keeps the original, a second apply
replaces the music instead of stacking it, and remove restores the clip.
ffmpeg is faked (CI has none); the real mix was checked in the container."""
import asyncio
import json
import os

import pytest

import music


@pytest.fixture
def fake_ffmpeg(monkeypatch):
    calls = []

    class Done:
        returncode, stderr = 0, ""

    def run(cmd, **kw):
        calls.append(cmd)
        if cmd[0] == "ffmpeg":
            src, out = cmd[cmd.index("-i") + 1], cmd[-1]
            open(out, "wb").write(open(src, "rb").read() + b"+music")
        return Done()
    monkeypatch.setattr(music.subprocess, "run", run)
    monkeypatch.setattr(music, "duration", lambda p: 30.0)
    monkeypatch.setattr(music, "has_audio", lambda p: True)
    return calls


def test_music_is_mixed_in_place_replaced_not_stacked_and_removable(tmp_path, fake_ffmpeg):
    clip = tmp_path / "clip_1.mp4"
    clip.write_bytes(b"video")
    music.add_music(str(clip), "m.wav", 0.2)
    assert clip.read_bytes() == b"video+music" and (tmp_path / "clip_1.nomusic.mp4").read_bytes() == b"video"
    music.add_music(str(clip), "m2.wav", 0.3)
    assert clip.read_bytes() == b"video+music"  # mixed from the original again
    assert music.remove_music(str(clip)) and clip.read_bytes() == b"video"
    assert not music.remove_music(str(clip))  # nothing left to remove


def test_mix_ducks_under_the_voice_and_copies_the_video():
    args = music.mix_args("in.mp4", "m.wav", "out.mp4", 0.2, 30.0, voice=True)
    graph = args[args.index("-filter_complex") + 1]
    assert "sidechaincompress" in graph and "amix" in graph and "afade=t=out:st=28.50" in graph
    assert args[args.index("-stream_loop") + 1] == "-1" and "copy" in args
    silent = music.mix_args("in.mp4", "m.wav", "out.mp4", 0.2, 30.0, voice=False)
    assert "sidechaincompress" not in silent[silent.index("-filter_complex") + 1]
    assert music.prompt_for("cinematic") == music.STYLES["cinematic"]
    assert music.prompt_for("cinematic", "  soft guitar ") == "soft guitar"


def test_auto_music_is_designed_for_each_clip():
    clip = {"music_prompt": "tense dark synth, 70 BPM", "video_title_for_youtube_short": "The fight"}
    assert music.clip_prompt(clip).startswith("tense dark synth, 70 BPM")
    assert "The fight" in music.clip_prompt({"video_title_for_youtube_short": "The fight"})  # older clip
    assert music.clip_prompt(clip, "upbeat") == music.STYLES["upbeat"]  # a picked style wins
    assert music.clip_prompt(clip, "auto", "my own words") == "my own words"


app = pytest.importorskip("app")


def test_auto_music_gives_each_clip_its_own_track(monkeypatch, tmp_path, fake_ffmpeg):
    monkeypatch.setattr(app, "BILLING_ENABLED", False)
    monkeypatch.setattr(app, "OUTPUT_DIR", str(tmp_path))
    monkeypatch.setattr(app, "_MUSIC_FILE", str(tmp_path / ".music.json"))
    monkeypatch.setattr(app, "_local_job_running", lambda name: False)
    monkeypatch.setattr(app._music, "available", lambda: True)
    job = tmp_path / "jobM"
    job.mkdir()
    for i in range(2):
        (job / f"c{i}.mp4").write_bytes(b"v")
    (job / "s_metadata.json").write_text(json.dumps({"shorts": [
        {"video_url": f"/videos/jobM/c{i}.mp4", "music_prompt": f"brief {i}"} for i in range(2)]}))
    made = []

    def gen(prompt, seconds, out):
        made.append(prompt)
        open(out, "wb").write(b"wav")
    monkeypatch.setattr(app._music, "generate", gen)
    monkeypatch.setattr(app._music, "release", lambda: None)

    asyncio.run(app._music_auto("jobM", {"status": "completed"}))
    assert made == []  # off by default
    asyncio.run(app.music_save_settings(app.MusicSettingsRequest(auto=True)))
    asyncio.run(app._music_auto("jobM", {"status": "completed"}))
    assert [m.split(",")[0] for m in made] == ["brief 0", "brief 1"]  # one track per clip, its own brief
    assert (job / "c0.mp4").read_bytes() == b"v+music" and (job / "c1.nomusic.mp4").exists()
    assert not list(job.glob(".music_*.wav"))  # the track is not left behind

    res = asyncio.run(app.clip_music(app.MusicRequest(job_id="jobM", clip_index=0, remove=True), None))
    assert res == {"new_video_url": "/videos/jobM/c0.mp4", "has_music": False}
    with pytest.raises(app.HTTPException):
        asyncio.run(app.clip_music(app.MusicRequest(job_id="jobM", clip_index=0, remove=True), None))
