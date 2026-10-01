"""Build openclip_colab.ipynb from openclip.ipynb (the Kaggle notebook).

The two differ only in where things live: Colab secrets instead of Kaggle's,
/content instead of /kaggle/working, and one T4 instead of two (Ollama and
the jobs share it, so one job at a time). Run this after editing the Kaggle
notebook:  python kaggle/make_colab.py
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))

HEADER = """# OpenClip on Google Colab
[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/sanupyadav/OpenClip/blob/main/kaggle/openclip_colab.ipynb)

Runtime → Change runtime type → **T4 GPU**. Free Colab has one T4: Ollama and the clip jobs share it, so jobs run one at a time.
Secrets (🔑 in the left sidebar, and switch on **Notebook access** for each): `LLM_BASE_URL` (your gateway's **tunnel** URL, e.g. `https://xxx.trycloudflare.com` — 127.0.0.1 is your PC, Colab can't reach it), `LLM_API_KEY`; optional `GEMINI_API_KEY`, `YOUTUBE_COOKIES` (Netscape format), `YOUTUBE_OAUTH` (contents of `output/.youtube.json` after connecting YouTube once on localhost), `HF_TOKEN` (background music: accept the license at huggingface.co/stabilityai/stable-audio-open-1.0 first).
Run all cells; the last one prints a public URL for the dashboard. Colab wipes `/content` when the session ends: download the clips you want to keep.
"""

REPLACE = [
    ("from kaggle_secrets import UserSecretsClient\n", "from google.colab import userdata\n"),
    ("    try: return UserSecretsClient().get_secret(name)\n", "    try: return userdata.get(name)\n"),
    ("/kaggle/working", "/content"),
    ("/kaggle/venv", "/content/venv"),
    ("in a Kaggle secret", "in a Colab secret"),
    ("Kaggle runs in the cloud", "Colab runs in the cloud"),
    ("is Kaggle itself", "is Colab itself"),
    ("this Kaggle box", "this Colab box"),
    ("Kaggle's preinstalled packages", "Colab's preinstalled packages"),
    ("Kaggle presets uv", "Colab may preset uv"),
    ("MAX_CONCURRENT_JOBS='2',", "MAX_CONCURRENT_JOBS='1' if N_GPUS < 2 else '2',"),
]


def build():
    nb = json.load(open(os.path.join(HERE, "openclip.ipynb")))
    nb["cells"][0]["source"] = HEADER.splitlines(keepends=True)
    for cell in nb["cells"][1:]:
        src = "".join(cell["source"])
        for a, b in REPLACE:
            src = src.replace(a, b)
        cell["source"] = src.splitlines(keepends=True)
        cell.pop("outputs", None) if cell["cell_type"] != "code" else cell.update(outputs=[], execution_count=None)
    nb["metadata"] = {**nb.get("metadata", {}), "accelerator": "GPU",
                      "colab": {"gpuType": "T4", "provenance": []}}
    left = [l for c in nb["cells"][1:] for l in c["source"] if "kaggle" in l.lower()]
    assert not left, f"Kaggle-only lines left in the Colab notebook: {left}"
    with open(os.path.join(HERE, "openclip_colab.ipynb"), "w") as f:
        f.write(json.dumps(nb, indent=1))


if __name__ == "__main__":
    build()
