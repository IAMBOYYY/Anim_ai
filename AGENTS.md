# AGENTS.md — AnimAI Studio architecture

Guidance for AI agents (and humans) working in this repository.

## Commands

```bash
npm install        # install deps
npm run dev        # dev server (Turbopack)
npm run build      # production build (run before finishing)
npm run lint       # eslint
npm run start      # serve production build
```

No `.env` file is required. Never commit keys or add server-side key storage.

## Ground rules

- **Keys are browser-only.** API keys live in IndexedDB, encrypted (WebCrypto AES-GCM; optional PBKDF2 passphrase). They are sent per-request to `/api/proxy` and never to any other backend, log, or analytics.
- **No `console.*` in `src/`** — errors surface via toast/agent task state. Never log request headers/bodies (they contain keys).
- **Client-first.** Only two server surfaces exist: `app/api/proxy/route.ts` (stateless forwarder) and static metadata/layout. Everything else runs in the browser.
- Match existing style: Tailwind v4 tokens (`bg-primary`, `text-muted-foreground`, `glass`), shadcn-style components in `components/ui`, framer-motion for transitions, `cn()` from `lib/utils` for class merging.
- Prefer editing existing files; adding a provider is the one common "new file" case.

## Directory map

| Path | Responsibility |
|---|---|
| `src/app/api/proxy/route.ts` | Stateless CORS proxy: accepts `{url, method, headers, body}`, forwards over https, returns bytes. No storage, no logging. |
| `src/app/` | Layout (ThemeProvider + Toaster), page (mounts workspace), error/not-found boundaries. |
| `src/lib/providers/types.ts` | **The adapter contract.** `Capability = text\|image\|video\|audio`, `ModelInfo`, `ProviderAdapter` (`validate`, `listModels`, optional `text/image/audio/video`), `ProviderError` (carries `retryable`/`rateLimited`). |
| `src/lib/providers/http.ts` | `proxyFetch()` (single funnel through the proxy), `withRetry()` (exp backoff + jitter, respects `AbortSignal`), `readSSE()` for streaming. |
| `src/lib/providers/openai-compat.ts` | Shared helpers for OpenAI-dialect APIs: `chatCompletion` (stream + non-stream), `generateImageOpenAI`, `speechOpenAI`, `listOpenAICompatModels`, `extractJson`. |
| `src/lib/providers/<name>.ts` | One file per provider (14 total incl. `custom.ts` for user-defined OpenAI-compatible base URL). |
| `src/lib/providers/registry.ts` | Ordered `PROVIDERS` array + `getAdapter(id, {customBaseUrl})`. **Adding a provider = 1 file + 1 line here.** |
| `src/lib/providers/capabilities.ts` | Heuristic model→capability classification, grouping, cost-hint estimates. |
| `src/lib/orchestrator/schema.ts` | zod `StoryboardSchema` (title/synopsis/scenes with narration, caption, imagePrompt, durationSec), planner system prompt, `parseStoryboard` (fenced-JSON tolerant), `buildSrt`/`buildVtt`. |
| `src/lib/orchestrator/runner.ts` | Agent implementations: `runPlanner`, `runWriter`, `runIllustrator`, `runCaptioner`, `runNarrator` + per-scene `illustrateScene`/`narrateScene`. `findRoute()` resolves capability→(provider, model, key); retries/backoff; task state machine (`queued\|working\|done\|failed\|skipped`). |
| `src/lib/orchestrator/pipeline.ts` | `runFullPipeline()` sequencing + `regenerateScene()`. |
| `src/lib/storage/db.ts` | Tiny promise-based IndexedDB wrapper (stores: `keys`, `settings`, `projects`, `meta`). |
| `src/lib/storage/keys.ts` | Encrypt/decrypt/save/remove keys; passphrase set/change re-encrypts everything. |
| `src/lib/storage/settings.ts` | zod-validated `AppSettings` (providers, defaults per capability, style, sceneCount, autoDownload, retries), `PROMPT_STYLES`, `availableRoutes()`. |
| `src/lib/storage/projects.ts` | `ProjectRecord` persistence (storyboard + Blob assets + logs) and summaries. |
| `src/lib/export/project.ts` | `buildExportProject()` (project.json shape) and `buildProjectHtml()` (self-contained viewer, data-URL inlined media). |
| `src/lib/export/zip.ts` | JSZip bundle: `images/ text/ captions/ audio/ prompts/ logs/ project.json project.html` + download helpers. |
| `src/components/workspace/store.tsx` | The app-wide context: settings, decrypted keys (in memory), tab state (localStorage-persisted), projects, theme (next-themes). |
| `src/components/workspace/workspace.tsx` | Shell: header, tab content host (all open tabs stay mounted so runs survive tab switches), unlock dialog, status strip. |
| `src/components/tabs/*` | The four tabs: chat, settings, files, viewer. |
| `src/components/chat/use-chat-run.ts` | Run lifecycle: builds `RunContext`, mirrors state into a ref (`mutate`) so post-run finalization sees the latest storyboard/assets, cancel/retry/regenerate/save. |

## Adding a provider (checklist)

1. Create `src/lib/providers/<name>.ts` exporting a `ProviderAdapter`:
   - `validate(apiKey)` → cheap authenticated GET returning `{ok, message}`.
   - `listModels(apiKey)` → `ModelInfo[]` (use `classifyModel()` for capabilities; curated list is fine if no models endpoint).
   - Optionally `text/image/audio/video` implementing `TextRequest→TextResult` etc. Use `proxyFetch` + `throwProviderError` + `withRetry`.
2. Register it in `src/lib/providers/registry.ts` (`PROVIDERS` array).
3. Nothing else — Settings renders cards from the registry automatically.

## Data flow of a run

```
user prompt
  → Planner (text) → zod-validated Storyboard
  → Writer (text) → narration/caption polish (graceful fallback to planner text)
  → Illustrator (image, 2 parallel) → Blob → assets[sceneIndex].image
  → Captioner (text) → captions (fallback: first sentence of narration)
  → Narrator (audio, sequential) → Blob → assets[sceneIndex].audio
  → ProjectRecord saved to IndexedDB → Files list refreshed
  → optional auto ZIP download (JSZip, client-side)
```

Every stage resolves its route via `findRoute()`: explicit `settings.defaults[cap]` first, else first enabled provider with a model **and** a decrypted key for that capability; otherwise the task is marked `skipped` with a human-readable reason (shown in Agent Activity + notices).

## State conventions

- Workspace-level state (settings, keys, tabs, projects) → `useWorkspace()` store.
- Per-chat-tab state (run, messages) → `useChatRun(tabId)`; keep a `dataRef` mirror and mutate through it (never call side effects inside `setState` updaters).
- Tabs stay mounted; hidden via CSS so long-running jobs continue.
- All media blobs are stored as `Blob`s in IndexedDB; data URLs are only created at HTML-export time.

## Testing manually (free keys)

Groq (text+TTS), Gemini (text/image/TTS) and OpenRouter (`:free` models) are the quickest way to exercise the full pipeline. A text-only key still produces plan → captions → project files; image/audio steps report as skipped.
