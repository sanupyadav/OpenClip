# openClip on Kaggle

Turn a long YouTube video (or an upload) into vertical 9:16 shorts, running on Kaggle's free GPUs.
Everything happens in one notebook: [`kaggle/openclip.ipynb`](kaggle/openclip.ipynb).

[![Open in Kaggle](https://kaggle.com/static/images/open-in-kaggle.svg)](https://kaggle.com/kernels/welcome?src=https://github.com/sanupyadav/OpenClip/blob/main/kaggle/openclip.ipynb)

## Setup

1. Click **Open in Kaggle** above, or on Kaggle go to **Create → New Notebook → File → Import Notebook**
   and pick `kaggle/openclip.ipynb`.
2. In the notebook's right-hand panel, **Session options**:
   - **Accelerator: GPU T4 x2**
   - **Internet: On** (needed to clone the repo, install packages and download videos)
3. Pick the AI model that finds the clip moments (below), then **Run all**.
4. The launch cell prints `Dashboard: https://….trycloudflare.com`. Open it: that is the app.
   Finished clips are also saved in `/kaggle/working/OpenClip/output`.

## Choose the AI model

The config cell (the first code cell) sets one of these.

| Option | What to set | Notes |
|---|---|---|
| **Ollama on Kaggle** (no key) | `USE_OLLAMA = True`, `OLLAMA_MODEL = "qwen2.5:7b"` | Installed and pulled by the notebook. Runs alone on GPU 1; the jobs use GPU 0. |
| **Your own OpenAI-compatible gateway** | Secrets `LLM_BASE_URL` (a public tunnel URL) and `LLM_API_KEY`; `MODEL = "…"` | `127.0.0.1` / `localhost` / a Docker name like `fba` is Kaggle itself, not your PC. On your PC run `cloudflared tunnel --url http://127.0.0.1:47821` and use the `https://….trycloudflare.com` it prints. |
| **Gemini** | Secret `GEMINI_API_KEY` | Free key at [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey). |

You can also change the model later in the dashboard: **Settings → Current AI model**
(gateway URL / key / model, and an Ollama section with a **Use Ollama** toggle).
The Ollama toggle only picks an Ollama that is already running; on Kaggle that means `USE_OLLAMA = True`.

## Secrets

Kaggle notebook editor → **Add-ons → Secrets** → **Add Secret**, then tick it for this notebook.
All are optional; keys stay in your Kaggle account and never in the notebook.

| Secret | Used for |
|---|---|
| `LLM_BASE_URL`, `LLM_API_KEY` | Your gateway (see above) |
| `GEMINI_API_KEY` | Gemini as the model; also layout picking and on-screen hooks |
| `YOUTUBE_COOKIES` | Netscape-format cookies, when YouTube asks Kaggle to "confirm you're not a bot" |

## Post to YouTube (free)

Clips can go straight to your channel through the YouTube Data API with your own Google project,
no Upload-Post needed. The dashboard's **Settings → YouTube (direct)** card walks through it:

1. [Google Cloud Console](https://console.cloud.google.com/apis/library/youtube.googleapis.com): create a
   project and enable **YouTube Data API v3**.
2. **OAuth consent screen**: External, add your Google account as a **Test user**.
3. **Credentials → Create OAuth client ID → Web application**, and add the **Authorized redirect URI**
   the card shows (`https://….trycloudflare.com/api/youtube/callback`; a new Kaggle tunnel is a new URI,
   add it too).
4. Paste the client ID and secret in the card, **Save client**, **Connect YouTube**.
5. Every clip now has a **youtube** button: title, description, tags, privacy, optional schedule.

Free quota is ~6 uploads a day. Google keeps uploads from a project it has not audited **private**:
make them public in YouTube Studio, or pass Google's free YouTube API audit.

## Send to Telegram (free)

**Settings → Telegram**: create a bot with [@BotFather](https://t.me/BotFather) (`/newbot`), paste the token,
message the bot (or add it to your group / make it admin of your channel), press **Find my chat** and pick it.
Every clip then has a **telegram** button, and sent clips get a mark. Bots can send 50 MB at most, so a bigger clip
goes as a compressed copy under 49 MB (same resolution, lower bitrate); the clip itself keeps full quality.

## What the notebook does

| Cell | Does |
|---|---|
| Config | Model choice, gateway check (`✅ … → 200`; `401` = wrong key), GPU split |
| Clone | Clones this repo, or `git pull`s it on a reused session |
| System | ffmpeg, fonts, Node 20, cloudflared |
| Python | Its own Python 3.11 venv (`/kaggle/venv`), apart from Kaggle's packages, plus the dashboard's npm packages |
| Ollama | Only with `USE_OLLAMA = True`: install, serve on its own GPU, pull the model |
| Launch | Stops anything an earlier run left (server, jobs, dashboard, tunnel, queue), starts backend + dashboard + tunnel, applies the model settings, prints the link |
| Logs | Backend / dashboard logs, which GPU each job got (`gpu.log`), `nvidia-smi` |
| Keep alive | Keeps the session running while you use the dashboard |

**GPUs.** With Ollama on, GPU 1 is Ollama's and every job runs on GPU 0; with it off, jobs take turns
on both T4s. Transcription (Whisper on CUDA) and video encoding (NVENC) use the GPU.

## Hindi videos: Hinglish by default

A Hindi transcript is rewritten in Roman letters right after transcription ("aaj ka Minecraft din"),
so subtitles, hooks and titles come out in Hinglish. It uses the same AI model as the clip picking
(with a built-in transliterator as the fallback). To keep Devanagari, set `HINGLISH=0` in the launch
cell's `env` (or the server's `.env`).

## Troubleshooting

- **`API key not valid` (Gemini) or `Name or service not known`:** the model URL is not reachable from
  Kaggle. Use a tunnel URL, Ollama, or a valid `GEMINI_API_KEY`.
- **The dashboard link shows Cloudflare 502:** the backend is not up yet or crashed. Check the Logs cell,
  then run the launch cell again (it cleans up the old run first).
- **A job failed:** press **Retry** in the Clip Generator or the Queue tab. The transcript is reused.
- **`GVS PO Token` / `n challenge solving failed` warnings from YouTube:** harmless as long as the log
  ends with `✅ Download succeeded`. If downloads start failing, add `YOUTUBE_COOKIES`.
- **New code is not showing:** run the clone cell again (it pulls), then the launch cell.
