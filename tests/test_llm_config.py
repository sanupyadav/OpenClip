import asyncio
import json
import os

import pytest

app = pytest.importorskip("app")


@pytest.fixture
def clean(monkeypatch, tmp_path):
    monkeypatch.setattr(app, "BILLING_ENABLED", False)
    monkeypatch.setattr(app, "_LLM_CONFIG_FILE", str(tmp_path / ".llm.json"))
    monkeypatch.setattr(app, "_llm_state", {"gateway": {}, "ollama": {}, "use_ollama": False})
    saved = {n: os.environ.pop(n) for n in app._LLM_ENV + ("LLM_PROVIDER",) if n in os.environ}
    yield tmp_path / ".llm.json"
    # The endpoints write os.environ directly: undo it for the other test files.
    for name in app._LLM_ENV + ("LLM_PROVIDER",):
        os.environ.pop(name, None)
    os.environ.update(saved)


def _put(**kw):
    return asyncio.run(app.set_local_llm(app.LlmConfigRequest(**kw)))


def _ollama(**kw):
    return asyncio.run(app.set_ollama(app.OllamaConfigRequest(**kw)))


def test_save_sets_env_persists_and_never_returns_the_key(clean):
    out = _put(base_url="https://gw.example.com/", api_key="sk-secret", model="deepseek/deepseek-v4-flash")
    assert os.environ["LLM_BASE_URL"] == "https://gw.example.com/v1"
    assert out["localLlm"]["hasKey"] is True and "sk-secret" not in json.dumps(out)
    assert json.loads(clean.read_text())["gateway"]["LLM_API_KEY"] == "sk-secret"
    assert oct(clean.stat().st_mode & 0o777) == "0o600"
    # A blank key keeps the saved one.
    _put(base_url="https://gw.example.com/v1", api_key="", model="m2")
    assert os.environ["LLM_API_KEY"] == "sk-secret" and os.environ["LLM_MODEL"] == "m2"


def test_saved_settings_are_loaded_on_start_including_the_old_flat_file(clean):
    clean.write_text(json.dumps({"LLM_BASE_URL": "http://gw:1/v1", "LLM_API_KEY": "k", "LLM_MODEL": "m"}))
    app._load_saved_llm()
    assert os.environ["LLM_BASE_URL"] == "http://gw:1/v1" and os.environ["LLM_MODEL"] == "m"


def test_empty_url_clears_and_bad_scheme_is_refused(clean):
    _put(base_url="https://gw.example.com", api_key="k")
    assert _put(base_url="")["localLlm"] is None
    assert "LLM_BASE_URL" not in os.environ
    app._load_saved_llm()  # the clear survives a restart even with .env set
    assert "LLM_BASE_URL" not in os.environ
    with pytest.raises(app.HTTPException):
        _put(base_url="gw.example.com")


def test_ollama_toggle_switches_profiles_and_back(clean):
    _put(base_url="https://gw.example.com", api_key="sk-secret", model="gw-model")
    out = _ollama(url="http://localhost:11434/", model="llama3.2", enabled=True)
    assert os.environ["LLM_BASE_URL"] == "http://localhost:11434/v1"
    assert os.environ["LLM_MODEL"] == "llama3.2" and "LLM_API_KEY" not in os.environ
    assert out["llmSettings"]["useOllama"] is True and out["llmSettings"]["gateway"]["hasKey"] is True
    _ollama(url="http://localhost:11434", model="llama3.2", enabled=False)
    assert os.environ["LLM_BASE_URL"] == "https://gw.example.com/v1"
    assert os.environ["LLM_API_KEY"] == "sk-secret" and os.environ["LLM_MODEL"] == "gw-model"
    # Survives a restart with the toggle on.
    _ollama(url="http://localhost:11434", model="llama3.2", enabled=True)
    for name in app._LLM_ENV:
        os.environ.pop(name, None)
    app._load_saved_llm()
    assert os.environ["LLM_MODEL"] == "llama3.2"


def test_ollama_needs_a_model_to_turn_on_and_off_without_gateway_means_gemini(clean):
    with pytest.raises(app.HTTPException):
        _ollama(url="http://localhost:11434", model="", enabled=True)
    _ollama(url="http://localhost:11434", model="qwen2.5", enabled=True)
    assert _ollama(url="http://localhost:11434", model="qwen2.5", enabled=False)["localLlm"] is None
    assert "LLM_BASE_URL" not in os.environ


def test_unreachable_ollama_is_a_424_with_a_hint_not_a_502(clean):
    # A tunnel replaces an origin 502 with its own HTML page; 424 gets through.
    with pytest.raises(app.HTTPException) as e:
        asyncio.run(app.list_ollama_models(url="http://127.0.0.1:9"))
    assert e.value.status_code == 424 and "USE_OLLAMA = True" in e.value.detail
