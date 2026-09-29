import sys
import types

import subtitles


def _fake_ct2(monkeypatch, gpus):
    monkeypatch.setitem(sys.modules, "ctranslate2",
                        types.SimpleNamespace(get_cuda_device_count=lambda: gpus))
    subtitles._default_whisper_device.cache_clear()


def test_gpu_host_defaults_to_cuda_float16(monkeypatch):
    monkeypatch.delenv("WHISPER_DEVICE", raising=False)
    monkeypatch.delenv("WHISPER_COMPUTE", raising=False)
    _fake_ct2(monkeypatch, 2)
    cfg = subtitles.get_whisper_config()
    assert (cfg["device"], cfg["compute_type"]) == ("cuda", "float16")


def test_cpu_host_defaults_to_cpu_int8(monkeypatch):
    monkeypatch.delenv("WHISPER_DEVICE", raising=False)
    monkeypatch.delenv("WHISPER_COMPUTE", raising=False)
    _fake_ct2(monkeypatch, 0)
    cfg = subtitles.get_whisper_config()
    assert (cfg["device"], cfg["compute_type"]) == ("cpu", "int8")


def test_env_still_wins(monkeypatch):
    monkeypatch.setenv("WHISPER_DEVICE", "cpu")
    monkeypatch.delenv("WHISPER_COMPUTE", raising=False)
    _fake_ct2(monkeypatch, 2)
    assert subtitles.get_whisper_config()["device"] == "cpu"
    subtitles._default_whisper_device.cache_clear()
