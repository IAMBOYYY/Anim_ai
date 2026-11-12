# AnimAI Studio

A dark-first, browser-based creative workspace where **multiple AI providers collaborate on a single prompt** to produce a full creative package: a storyboard plan, polished narration, scene illustrations, captions (SRT/VTT) and voice-over audio — then export it all as a ZIP with a self-contained `project.html` viewer.

> **Privacy first:** your API keys never leave your browser. They are encrypted with WebCrypto (AES-GCM, optionally passphrase-protected via PBKDF2) in IndexedDB, and travel only with individual requests through a **stateless CORS proxy** that stores and logs nothing.

---

## Stack

- **Next.js 16** (App Router) + **TypeScript** + **Tailwind CSS v4**
- **shadcn/ui-style** components (Radix primitives + CVA)
- **Framer Motion** transitions, **sonner** toasts, **zod** validation
- **JSZip** for client-side packaging
- Deployable to **Vercel** — **no `.env` required** (keys are supplied by the user at runtime)

---

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000 → **Settings** → paste a free API key → **Chat** → send a prompt.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with Turbopack |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |

---

## Free API keys (great for testing)

| Provider | Get a key | Free tier notes |
|---|---|---|
| **Groq** | https://console.groq.com/keys | Very generous free LPU inference for text/TTS |
| **Google Gemini** | https://aistudio.google.com/apikey | Free tier for text, image gen and TTS |
| **OpenRouter** | https://openrouter.ai/keys | Look for `:free` models |
| **Hugging Face** | https://huggingface.co/settings/tokens/new | Inference Providers free credits |
| **NVIDIA NIM** | https://build.nvidia.com/nimkeys | Free credits for NIM endpoints |
| **Together** | https://api.together.ai/settings/api-keys | Free credits on signup |
| **Mistral** | https://console.mistral.ai/api-keys | Free tier models |
| **OpenAI / Anthropic / Replicate / fal.ai / Stability / ElevenLabs** | links on each provider card | Paid or trial credits |

You only need **one text key** to run the Planner/Writer/Captioner. Add an **image**-capable provider for illustrations and an **audio**-capable provider for narration — missing capabilities are skipped gracefully and clearly reported.

---

## Using the studio

1. **Settings tab**
   - Paste a key → **Save & test**. The key is validated and the provider’s **live model list** is fetched and grouped by capability (text / image / video / audio). Search it, then click a model to make it that capability’s default for that provider.
   - Use **Default routing** to explicitly choose which provider/model wins per capability.
   - Toggle providers on/off, set an optional **encryption passphrase**, and **export/import settings** (never includes keys).
2. **Chat tab**
   - Pick a style (cinematic, anime, 3D, watercolor, pixel, comic, noir, storybook), number of scenes, and a template — or write your own brief.
   - **Run** (`Ctrl/Cmd+Enter`): the **Planner** produces a zod-validated storyboard JSON; then **Writer**, **Illustrator** (per scene, parallel), **Captioner** and **Narrator** run, streaming progress into the **Agent Activity** panel with status, duration, retries and cost hints.
   - `Esc` cancels. Failed/skipped tasks show a **retry** button; each scene has **image** / **voice** regenerate buttons.
3. **Output**
   - Download the **ZIP** (`/images /text /captions /audio /prompts /logs` + `project.json` + `project.html`), or just `project.html` — a fully self-contained viewer with inlined images and audio.
   - Enable **auto-download** in Settings if you want the ZIP automatically after each run.
4. **Files tab** — history of past projects stored locally; reopen, re-download, delete.
5. **Project Viewer tab** — renders the self-contained `project.html` in a sandboxed iframe.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd + 1…4` | Switch to tab at that position |
| `Ctrl/Cmd + Shift + N` | New Chat tab |
| `Ctrl/Cmd + Shift + S` | Open Settings |
| `Ctrl/Cmd + Shift + L` | Toggle light / dark theme |
| `Ctrl/Cmd + Enter` | Send prompt |
| `Esc` | Cancel running job |

Tabs are **closable, reorderable (drag)** and **persist across reloads**; `+` opens a new tab.

---

## Architecture

```
src/
├─ app/
│  ├─ api/proxy/route.ts      # stateless CORS proxy (key per request, never stored/logged)
│  ├─ layout.tsx / page.tsx / error.tsx / not-found.tsx
├─ components/
│  ├─ ui/                     # shadcn-style primitives
│  ├─ workspace/              # tab shell, store (tabs/settings/keys/projects), shortcuts
│  ├─ tabs/                   # chat, settings, files, viewer tabs
│  └─ chat/                   # run hook, activity panel, scene cards
└─ lib/
   ├─ providers/              # ONE FILE PER PROVIDER behind a single adapter interface
   │  ├─ types.ts             # ProviderAdapter interface + Capability model
   │  ├─ http.ts              # proxyFetch + retry/backoff + SSE reader
   │  ├─ openai-compat.ts     # shared OpenAI-dialect helpers
   │  ├─ google.ts, openai.ts, groq.ts, … , custom.ts
   │  └─ registry.ts          # ordered registry — adding a provider = 1 file + 1 line
   ├─ orchestrator/           # zod storyboard schema, agents, pipeline
   ├─ storage/                # IndexedDB: encrypted keys, settings, projects
   ├─ export/                 # project.json / project.html / JSZip bundle
   └─ crypto.ts               # WebCrypto AES-GCM + PBKDF2
```

**Adding a provider** = create `src/lib/providers/<name>.ts` exporting a `ProviderAdapter` (validate, listModels, and any of text/image/audio/video) and add it to `PROVIDERS` in `registry.ts`. See `AGENTS.md`.

---

## Deploying to Vercel

1. Push the repository to GitHub:

   ```bash
   git add -A
   git commit -m "feat: AnimAI Studio"
   git push -u origin main
   ```

2. Go to https://vercel.com/new → **Import** the repository. Vercel auto-detects **Next.js** (no framework config needed).

3. Leave **Environment Variables empty** — none are required. Deploy.

4. Open the deployed URL → Settings → add your keys → Chat → run.

> The app is fully client-side except for the stateless proxy route (`/api/proxy`), which works out-of-the-box on Vercel.

---

## Notes & limits

- Keys are stored **only** in this browser’s IndexedDB (encrypted). Clearing site data removes them; export/import moves **settings only**, never keys.
- Model lists are fetched **live** from each provider; some providers fall back to a curated list if they don’t expose a models endpoint.
- Cost figures shown are rough **estimates** for guidance only.
- Video generation is declared for providers that support it (Replicate, fal.ai, Stability, Together, OpenAI/Sora) and behaves like the other media agents when configured.
