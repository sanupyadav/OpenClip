import asyncio
import json
import os

import pytest

app = pytest.importorskip("app")


@pytest.fixture
def clean(monkeypatch, tmp_path):
    monkeypatch.setattr(app, "BILLING_ENABLED", False)
    monkeypatch.setattr(app, "_LLM_CONFIG_FILE", str(tmp_path / ".llm.json"))
    for name in app._LLM_ENV + ("LLM_PROVIDER",):
        monkeypatch.delenv(name, raising=False)
    return tmp_path / ".llm.json"


def _put(**kw):
    return asyncio.run(app.set_local_llm(app.LlmConfigRequest(**kw)))


def test_save_sets_env_persists_and_never_returns_the_key(clean):
    out = _put(base_url="https://gw.example.com/", api_key="sk-secret", model="deepseek/deepseek-v4-flash")
    assert os.environ["LLM_BASE_URL"] == "https://gw.example.com/v1"
    assert out["localLlm"]["hasKey"] is True and "sk-secret" not in json.dumps(out)
    assert json.loads(clean.read_text())["LLM_API_KEY"] == "sk-secret"
    assert oct(clean.stat().st_mode & 0o777) == "0o600"
    # A blank key keeps the saved one.
    _put(base_url="https://gw.example.com/v1", api_key="", model="m2")
    assert os.environ["LLM_API_KEY"] == "sk-secret" and os.environ["LLM_MODEL"] == "m2"


def test_saved_gateway_is_loaded_on_start(clean):
    clean.write_text(json.dumps({"LLM_BASE_URL": "http://gw:1/v1", "LLM_API_KEY": "k", "LLM_MODEL": "m"}))
    app._load_saved_llm()
    assert os.environ["LLM_BASE_URL"] == "http://gw:1/v1" and os.environ["LLM_MODEL"] == "m"


def test_empty_url_clears_and_bad_scheme_is_refused(clean):
    _put(base_url="https://gw.example.com", api_key="k")
    assert _put(base_url="") == {"localLlm": None}
    assert "LLM_BASE_URL" not in os.environ and not clean.exists()
    with pytest.raises(app.HTTPException):
        _put(base_url="gw.example.com")
