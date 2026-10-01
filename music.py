"""Background music for clips: Stable Audio Open 1.0 + an ffmpeg mix.

Stable Audio Open writes instrumental music from a text prompt, up to 47 s,
and its Stability Community License allows commercial use (free under $1M
a year in revenue), which a monetized channel needs. MusicGen's weights are
non-commercial and HeartMuLa writes songs with vocals that would talk over
the speaker. The model is gated on Hugging Face: accept its license there
once and set HF_TOKEN.

The music is mixed in place: the clip keeps its file name (so the gallery,
the uploads and every later edit see the music) and the original is kept
next to it as ``<stem>.nomusic.mp4``, which is what "remove" and "change"
go back to.
"""
import gc
import os
import subprocess
import threading
import wave

MODEL_ID = os.environ.get("MUSIC_MODEL") or "stabilityai/stable-audio-open-1.0"
MAX_SECONDS = 47  # the model's limit; longer clips loop the track
STEPS = int(os.environ.get("MUSIC_STEPS", "50"))
NOMUSIC = ".nomusic.mp4"

STYLES = {
    "lofi": "lofi hip hop beat, chill, soft piano, mellow drums, relaxed background music",
    "upbeat": "upbeat happy pop instrumental, bright guitar, claps, positive background music",
    "cinematic": "cinematic ambient instrumental, soft strings, emotional, inspiring build",
    "energetic": "energetic electronic instrumental, punchy drums, driving synth bass, hype",
    "corporate": "light corporate background music, clean acoustic guitar, soft percussion, motivational",
    "suspense": "suspenseful dark ambient instrumental, low pulses, tension, mystery",
}
NEGATIVE = "vocals, singing, voice, speech, low quality, distortion, noise"

_pipe = None
_lock = threading.Lock()  # one generation at a time: the model is ~5 GB of VRAM


def available() -> bool:
    try:
        import diffusers  # noqa: F401
        return True
    except ImportError:
        return False


def prompt_for(style: str, prompt: str = "") -> str:
    return (prompt or "").strip() or STYLES.get(style) or STYLES["lofi"]


def _load():
    global _pipe
    if _pipe is None:
        import torch
        from diffusers import StableAudioPipeline
        cuda = torch.cuda.is_available()
        _pipe = StableAudioPipeline.from_pretrained(
            MODEL_ID, torch_dtype=torch.float16 if cuda else torch.float32,
            token=os.environ.get("HF_TOKEN") or None)
        # MUSIC_DEVICE: on Kaggle the Ollama card, away from the clip jobs.
        _pipe = _pipe.to((os.environ.get("MUSIC_DEVICE") or "cuda") if cuda else "cpu")
    return _pipe


def release():
    """Hand the VRAM back to the clip jobs."""
    global _pipe
    _pipe = None
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except ImportError:
        pass


def generate(prompt: str, seconds: float, out_wav: str) -> str:
    """Write ``seconds`` (capped at 47) of music for ``prompt`` as a 16-bit WAV."""
    import numpy as np
    import torch
    with _lock:
        pipe = _load()
        audio = pipe(prompt, negative_prompt=NEGATIVE, num_inference_steps=STEPS,
                     audio_end_in_s=float(max(5, min(MAX_SECONDS, seconds))),
                     generator=torch.Generator(pipe.device).manual_seed(int.from_bytes(os.urandom(4), "big")),
                     ).audios[0]
        rate = pipe.vae.sampling_rate
    samples = audio.T.float().cpu().numpy()  # (n, channels)
    peak = float(np.abs(samples).max()) or 1.0
    pcm = (samples / peak * 0.95 * 32767).astype("<i2")
    with wave.open(out_wav, "wb") as w:
        w.setnchannels(pcm.shape[1])
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())
    return out_wav


def duration(path: str) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "default=nw=1:nk=1", path], capture_output=True, text=True)
    try:
        return float(out.stdout.strip())
    except ValueError:
        return 0.0


def has_audio(path: str) -> bool:
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries",
                          "stream=index", "-of", "csv=p=0", path], capture_output=True, text=True)
    return bool(out.stdout.strip())


def mix_args(video: str, music_wav: str, out: str, volume: float, length: float, voice: bool) -> list:
    """ffmpeg command: the music looped under the clip's audio, ducked while
    someone speaks (sidechain on the voice), faded in and out. Video copied."""
    volume = max(0.0, min(1.0, float(volume)))
    fade_at = max(0.0, length - 1.5)
    music = (f"[1:a]volume={volume:.3f},afade=t=in:d=1,afade=t=out:st={fade_at:.2f}:d=1.5,"
             f"aformat=sample_rates=48000:channel_layouts=stereo[m]")
    if voice:
        graph = (f"[0:a]aformat=sample_rates=48000:channel_layouts=stereo,asplit=2[voice][key];{music};"
                 "[m][key]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[duck];"
                 "[voice][duck]amix=inputs=2:duration=first:normalize=0[a]")
    else:
        graph = music.replace("[m]", "[a]")
    return ["ffmpeg", "-y", "-v", "error", "-i", video, "-stream_loop", "-1", "-i", music_wav,
            "-filter_complex", graph, "-map", "0:v", "-map", "[a]", "-c:v", "copy",
            "-c:a", "aac", "-b:a", "192k", "-t", f"{length:.3f}", "-movflags", "+faststart", out]


def nomusic_path(path: str) -> str:
    return os.path.splitext(path)[0] + NOMUSIC


def original(clip_path: str) -> str:
    """The clip without music: the kept original if there is one."""
    o = nomusic_path(clip_path)
    return o if os.path.exists(o) else clip_path


def add_music(clip_path: str, music_wav: str, volume: float = 0.18):
    """Mix ``music_wav`` into ``clip_path`` in place, keeping the original as
    ``<stem>.nomusic.mp4`` (a second call replaces the music, never stacks it)."""
    original = nomusic_path(clip_path)
    if not os.path.exists(original):
        os.replace(clip_path, original)
    tmp = clip_path + ".music.tmp.mp4"
    length = duration(original)
    proc = subprocess.run(mix_args(original, music_wav, tmp, volume, length, has_audio(original)),
                          capture_output=True, text=True)
    if proc.returncode != 0 or not os.path.exists(tmp):
        if not os.path.exists(clip_path):
            os.replace(original, clip_path)  # leave the clip as it was
        raise RuntimeError(f"ffmpeg could not mix the music: {proc.stderr[-300:]}")
    os.replace(tmp, clip_path)


def remove_music(clip_path: str) -> bool:
    original = nomusic_path(clip_path)
    if not os.path.exists(original):
        return False
    os.replace(original, clip_path)
    return True
