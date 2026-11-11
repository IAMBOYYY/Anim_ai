import { proxyFetch, readErrorDetail, throwProviderError, withRetry } from "./http";
import { arrayBufferToBase64 } from "./openai-compat";
import type {
  AudioRequest,
  AudioResult,
  ImageRequest,
  ImageResult,
  ModelInfo,
  ProviderAdapter,
  TextRequest,
  TextResult,
  VideoRequest,
  VideoResult,
} from "./types";

const BASE = "https://api.replicate.com/v1";

function headers(apiKey: string): Record<string, string> {
  return { authorization: `Token ${apiKey}`, "content-type": "application/json" };
}

async function validate(apiKey: string, signal?: AbortSignal) {
  const json = (await fetchAccount(apiKey, signal)) as { username?: string };
  return { ok: true, message: `Key valid — ${json.username ?? "account"}` };
}

async function fetchAccount(apiKey: string, signal?: AbortSignal) {
  return withRetry(
    async () => {
      const r = await proxyFetch(`${BASE}/account`, { headers: headers(apiKey), signal });
      if (!r.ok) throwProviderError(r, await readErrorDetail(r));
      return r.json() as Promise<unknown>;
    },
    { signal, retries: 2 }
  );
}

async function listModels(apiKey: string, signal?: AbortSignal): Promise<ModelInfo[]> {
  const res = await withRetry(
    async () => {
      const r = await proxyFetch(`${BASE}/models?limit=100`, { headers: headers(apiKey), signal });
      if (!r.ok) throwProviderError(r, await readErrorDetail(r));
      return r;
    },
    { signal, retries: 2 }
  );
  const json = (await res.json()) as {
    results?: { url?: string; owner?: string; name?: string; description?: string; tags?: string[] }[];
  };
  const out: ModelInfo[] = [];
  for (const m of json.results ?? []) {
    const id = m.url ? `${m.owner}/${m.name}` : m.name;
    if (!id) continue;
    const tags = (m.tags ?? []).map((t) => t.toLowerCase());
    const caps: ModelInfo["capabilities"] = [];
    if (tags.some((t) => t.includes("image") || t.includes("diffusion") || t.includes("flux"))) caps.push("image");
    if (tags.some((t) => t.includes("video"))) caps.push("video");
    if (tags.some((t) => t.includes("audio") || t.includes("speech") || t.includes("music"))) caps.push("audio");
    if (tags.some((t) => t.includes("text") || t.includes("language") || t.includes("chat")) || caps.length === 0) caps.push("text");
    out.push({ id, name: `${m.owner}/${m.name}`, capabilities: [...new Set(caps)], notes: m.description?.slice(0, 80) });
  }
  // Always include a few well-known ones
  const extra: ModelInfo[] = [
    { id: "black-forest-labs/flux-schnell", name: "FLUX schnell", capabilities: ["image"] },
    { id: "stabilityai/stable-diffusion-xl", name: "SDXL", capabilities: ["image"] },
    { id: "minimax/video-01", name: "MiniMax Hailuo", capabilities: ["video"] },
    { id: "luma/ray", name: "Luma Ray", capabilities: ["video"] },
  ];
  const seen = new Set(out.map((m) => m.id));
  for (const e of extra) if (!seen.has(e.id)) out.push(e);
  return out;
}

async function runPrediction(
  apiKey: string,
  versionOrPath: string,
  input: Record<string, unknown>,
  signal?: AbortSignal,
  onProgress?: (m: string) => void
): Promise<Record<string, unknown>> {
  const isVersion = /^[a-f0-9]{32,}$/i.test(versionOrPath);
  const url = isVersion ? `${BASE}/predictions` : `${BASE}/models/${versionOrPath}/predictions`;

  const created = (await withRetry(
    async () => {
      const r = await proxyFetch(url, {
        method: "POST",
        headers: { ...headers(apiKey), prefer: "wait=60" },
        body: JSON.stringify(isVersion ? { version: versionOrPath, input } : { input }),
        signal,
      });
      if (!r.ok) throwProviderError(r, await readErrorDetail(r));
      return r.json() as Promise<Record<string, unknown>>;
    },
    { signal, retries: 1 }
  )) as { id?: string; status?: string; output?: unknown; error?: unknown; urls?: { get?: string } };

  let prediction = created;
  const deadline = Date.now() + 180_000;
  while (
    (prediction.status === "starting" || prediction.status === "processing" || prediction.status === "queued") &&
    Date.now() < deadline
  ) {
    onProgress?.(`Replicate: ${prediction.status}`);
    await new Promise((r) => setTimeout(r, 1500));
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const get = prediction.urls?.get;
    if (!get) break;
    const r = await proxyFetch(get, { headers: headers(apiKey), signal });
    if (!r.ok) throwProviderError(r, await readErrorDetail(r));
    prediction = (await r.json()) as typeof prediction;
  }
  if (prediction.status === "failed" || prediction.error) {
    throw new Error(`Replicate prediction failed: ${String(prediction.error ?? "unknown error")}`);
  }
  return prediction;
}

function firstOutputUrl(output: unknown): string | undefined {
  if (typeof output === "string") return output;
  if (Array.isArray(output) && typeof output[0] === "string") return output[0];
  return undefined;
}

export const replicate: ProviderAdapter = {
  id: "replicate",
  name: "Replicate",
  tagline: "Run any open model on demand (per-second billing)",
  keyUrl: "https://replicate.com/account/api-tokens",
  keyHint: "r8_…",
  capabilities: ["text", "image", "video", "audio"],
  keyPattern: /^r8_[A-Za-z0-9]{10,}$/,
  validate,
  listModels,

  async text(apiKey, req: TextRequest): Promise<TextResult> {
    const out = await runPrediction(
      apiKey,
      req.model,
      { prompt: req.prompt, system_prompt: req.system, max_tokens: req.maxTokens ?? 2048 },
      req.signal
    );
    const text = typeof out.output === "string" ? out.output : JSON.stringify(out.output ?? "");
    req.stream?.(text);
    return { text, model: req.model };
  },

  async image(apiKey, req: ImageRequest): Promise<ImageResult> {
    const out = await runPrediction(
      apiKey,
      req.model,
      { prompt: req.prompt, aspect_ratio: req.aspectRatio ?? "2:3", num_outputs: 1 },
      req.signal
    );
    const url = firstOutputUrl(out.output);
    if (!url) throw new Error("Replicate returned no image");
    return { url, mimeType: "image/png", model: req.model };
  },

  async audio(apiKey, req: AudioRequest): Promise<AudioResult> {
    const out = await runPrediction(apiKey, req.model, { text: req.text, prompt: req.text }, req.signal);
    const url = firstOutputUrl(out.output);
    if (!url) throw new Error("Replicate returned no audio");
    return { url, mimeType: "audio/mpeg", model: req.model };
  },

  async video(apiKey, req: VideoRequest): Promise<VideoResult> {
    const out = await runPrediction(
      apiKey,
      req.model,
      { prompt: req.prompt },
      req.signal,
      req.onProgress
    );
    const url = firstOutputUrl(out.output);
    if (!url) throw new Error("Replicate returned no video");
    return { url, mimeType: "video/mp4", model: req.model };
  },
};

export { arrayBufferToBase64 };
