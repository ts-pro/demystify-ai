<div align="center">

<img src="icons/icon-128.png" width="120" height="120" alt="Demystify AI ghost logo" />

# Demystify AI 👻

**Highlight anything. Understand everything.**

A Chrome extension that rewrites confusing text in plain language and explains
every jargon term inline — powered by your own OpenAI or Anthropic key.

<br />

![Manifest](https://img.shields.io/badge/Manifest-V3-4a90e2?style=flat-square)
![No build step](https://img.shields.io/badge/build-none-2e7d32?style=flat-square)
![Providers](https://img.shields.io/badge/AI-OpenAI%20%7C%20Anthropic-8e44ad?style=flat-square)
![Languages](https://img.shields.io/badge/languages-12-f39c12?style=flat-square)

</div>

---

## ✨ What it does

Select any dense, jargon-filled passage on any web page, right-click, and pick
**"Demystify with AI"**. In a moment a clean popup appears next to your
selection with:

- 📝 **A plain-language rewrite** of the passage — no fluff, no inline clutter.
- 🔍 **Per-term tooltips** — every technical term, abbreviation, and company name
  is highlighted; hover to see a short explanation.
- 🧠 **A memory** — mark terms you already understand as *known*, and the AI
  stops re-explaining them.

Everything runs directly between your browser and the AI provider you choose.
There is **no server**, no analytics, and no data collection.

---

## 🎬 How to use it

| Step | Action |
|------|--------|
| **1** | Select the text you want simplified on any page. |
| **2** | Right-click and choose **"Demystify with AI"** 👻 |
| **3** | Read the plain-language rewrite in the popup. |
| **4** | Hover any highlighted term for an inline explanation. |
| **5** | Seen a term enough times? Click **"Mark selected as known"** so it's skipped next time. |

---

## ⚙️ Setup

The extension uses **your own API key** — you stay in full control of usage and cost.

1. Click the Demystify AI icon → **Settings** (or right-click the icon → *Options*).
2. Pick your **Provider**: OpenAI or Anthropic.
3. Paste your **API key** and hit **Test** to confirm it works.
4. Choose a **model**:
   - OpenAI — `gpt-4o-mini` (fast/cheap) or `gpt-4o`
   - Anthropic — `claude-haiku-4-5` (fast/cheap) or `claude-sonnet-4-6`
5. Pick your **explanation language** (see below).
6. **Save.** You're ready to demystify. 🎉

Your key and preferences are stored **locally** via Chrome `storage` and are only
ever sent to the provider you selected.

### 🌍 Supported languages

Explanations can be returned in **auto-detect (match the source)** or any of:

🇬🇧 English · 🇺🇦 Ukrainian · 🇪🇸 Spanish · 🇫🇷 French · 🇩🇪 German ·
🇵🇱 Polish · 🇵🇹 Portuguese · 🇨🇳 Chinese (Simplified) · 🇯🇵 Japanese ·
🇸🇦 Arabic · 🇮🇹 Italian

---

## 🔒 Privacy

- **No backend.** Requests go straight from your browser to OpenAI / Anthropic.
- **No tracking.** No analytics, no telemetry, nothing sent to the developer.
- **Your key stays local.** Stored in Chrome storage on your device only.

Full details in [PRIVACY.md](PRIVACY.md).

---

## 🛠️ Install from source (development)

No build step, no npm — it's plain ES2022 + HTML + CSS.

```bash
git clone https://github.com/havrashenko/chrome-explanator.git
```

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select the project folder.
4. Open the extension's **Settings** and add your API key.

---

## 🧩 How it works

```
Selection ──▶ context menu ──▶ background service worker
                                     │
                                     ▼
              builds a prompt (context + selection + known terms)
                                     │
                                     ▼
                 OpenAI / Anthropic REST API  (your key)
                                     │
                                     ▼
        JSON { rewritten, terms[] } ──▶ content script
                                     │
                                     ▼
     Shadow-DOM popup with rewrite + hover tooltips per term
```

| File | Role |
|------|------|
| `manifest.json` | Manifest V3 config, permissions, scripts. |
| `background.js` | Service worker: context menu, prompt building, AI calls. |
| `content.js` | Renders the popup and per-term tooltips (isolated Shadow DOM). |
| `options.html` / `options.js` | Settings UI: provider, keys, model, language, known terms. |
| `prompts/system-prompt.txt` | The prompt template driving the rewrite. |

---

<div align="center">

Made with 👻 to make dense text disappear.

</div>
