import { proxyFetch, readErrorDetail, throwProviderError, withRetry } from "./http";
import type {
  AudioRequest,
  AudioResult,
  ImageRequest,
  ImageResult,
  ModelInfo,
  ProviderAdapter,
  VideoRequest,
  VideoResult,
} from "./types";

const REST = "https://rest.fal.ai";

function headers(apiKey: string): Record<string, string> {
  return { authorization: `Key ${apiKey}`, "content-type": "application/json" };
}

async function validate(apiKey: string, signal?: AbortSignal) {
  const json = (await withRetry(
    async () => {
      const r = await proxyFetch(`${REST}/v1/me`, { headers: headers(apiKey), signal });
      if (!r.ok) throwProviderError(r, await readErrorDetail(r));
      return r.json() as Promise<{ user?: { id?: string; name?: string } }>;
    },
    { signal, retries: 1 }
  )) as { user?: { id?: string; name?: string } };
  return { ok: true, message: `Key valid — ${json.user?.name ?? json.user?.id ?? "user"}` };
}

const CURATED: ModelInfo[] = [
  { id: "fal-ai/flux/dev", name: "FLUX.1 dev", capabilities: ["image"] },
  { id: "fal-ai/flux/schnell", name: "FLUX.1 schnell", capabilities: ["image"] },
  { id: "fal-ai/flux-pro/v1", name: "FLUX.1 Pro", capabilities: ["image"] },
  { id: "fal-ai/recraft-v3", name: "Recraft V3", capabilities: ["image"] },
  { id: "fal-ai/stable-diffusion-v3-large", name: "SD3 Large", capabilities: ["image"] },
  { id: "fal-ai/minimax/video-01", name: "MiniMax Video", capabilities: ["video"] },
  { id: "fal-ai/luma-dream-machine", name: "Luma Dream Machine", capabilities: ["video"] },
  { id: "fal-ai/kling-video/v1/standard/text-to-video", name: "Kling 1.6", capabilities: ["video"] },
  { id: "fal-ai/minimax/speech-02-turbo", name: "MiniMax Speech", capabilities: ["audio"] },
  { id: "fal-ai/elevenlabs/tts/turbo-v2.5", name: "ElevenLabs Turbo", capabilities: ["audio"] },
];

async function listModels(apiKey: string, signal?: AbortSignal): Promise<ModelInfo[]> {
  try {
    const r = await proxyFetch(`${REST}/v1/models?limit=100`, { headers: headers(apiKey), signal });
    if (r.ok) {
      const json = (await r.json()) as {
        items?: { id?: string; name?: string; description?: string; category?: string }[];
      };
      const out: ModelInfo[] = [];
      for (const m of json.items ?? []) {
        if (!m.id) continue;
        const cat = `${m.category ?? ""} ${m.id}`.toLowerCase();
        const caps: ModelInfo["capabilities"] = [];
        if (cat.includes("image") || cat.includes("flux") || cat.includes("diffusion")) caps.push("image");
        if (cat.includes("video")) caps.push("video");
        if (cat.includes("audio") || cat.includes("speech") || cat.includes("tts") || cat.includes("music")) caps.push("audio");
        if (caps.length === 0) caps.push("text");
        out.push({ id: m.id, name: m.name || m.id, capabilities: caps, notes: m.description?.slice(0, 80) });
      }
      if (out.length) return out;
    }
  } catch {
    /* fall back to curated */
  }
  return CURATED;
}

async function run(
  apiKey: string,
  modelId: string,
  input: Record<string, unknown>,
  signal?: AbortSignal,
  onProgress?: (m: string) => void
): Promise<Record<string, unknown>> {
  const url = `https://fal.run/${modelId}`;
  const started = (await withRetry(
    async () => {
      const r = await proxyFetch(url, {
        method: "POST",
        headers: { ...headers(apiKey), "x-fal-stream": "false" },
        body: JSON.stringify(input),
        signal,
      });
      if (!r.ok) throwProviderError(r, await readErrorDetail(r));
      return r.json() as Promise<Record<string, unknown>>;
    },
    { signal, retries: 1 }
  )) as { request_id?: string; status_url?: string; response_url?: string; images?: { url?: string }[]; image?: { url?: string }; video?: { url?: string }; audio?: { url?: string } };

  // Some models enqueue; poll status_url if present.
  if (started.status_url && !started.images && !started.video && !started.audio) {
    const deadline = Date.now() + 180_000;
    let state = started as Record<string, unknown> & { status?: string };
    while (state.status === "IN_PROGRESS" || state.status === "IN_QUEUE") {
      onProgress?.(`fal.ai: ${state.status}`);
      if (Date.now() > deadline) break;
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      await new Promise((r) => setTimeout(r, 1500));
      const r = await proxyFetch(String(state.status_url), { headers: headers(apiKey), signal });
      if (!r.ok) throwProviderError(r, await readErrorDetail(r));
      state = (await r.json()) as typeof state;
      if (state.status === "COMPLETED" && state.response_url) {
        const rr = await proxyFetch(String(state.response_url), { headers: headers(apiKey), signal });
        state = (await rr.json()) as typeof state;
        break;
      }
    }
    return state;
  }
  return started;
}

function pickUrl(json: Record<string, unknown>): string | undefined {
  const j = json as {
    images?: { url?: string }[];
    image?: { url?: string };
    video?: { url?: string };
    audio?: { url?: string };
    output?: unknown;
  };
  return j.images?.[0]?.url || j.image?.url || j.video?.url || j.audio?.url || firstOf(j.output);
}

function firstOf(output: unknown): string | undefined {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    const first = output[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object" && "url" in first) return String((first as { url: unknown }).url);
  }
  if (output && typeof output === "object" && "url" in output) return String((output as { url: unknown }).url);
  return undefined;
}

export const fal: ProviderAdapter = {
  id: "fal",
  name: "fal.ai",
  tagline: "Fast serverless image, video & audio models",
  keyUrl: "https://fal.ai/dashboard/keys",
  keyHint: "key_id:key_secret",
  capabilities: ["image", "video", "audio"],
  validate,
  listModels,

  async image(apiKey, req: ImageRequest): Promise<ImageResult> {
    const json = await run(
      apiKey,
      req.model,
      { prompt: req.prompt, image_size: aspectToSize(req.aspectRatio), num_images: 1 },
      req.signal
    );
    const url = pickUrl(json);
    if (!url) throw new Error("fal.ai returned no image");
    return { url, mimeType: "image/png", model: req.model };
  },

  async video(apiKey, req: VideoRequest): Promise<VideoResult> {
    const json = await run(apiKey, req.model, { prompt: req.prompt }, req.signal, req.onProgress);
    const url = pickUrl(json);
    if (!url) throw new Error("fal.ai returned no video");
    return { url, mimeType: "video/mp4", model: req.model };
  },

  async audio(apiKey, req: AudioRequest): Promise<AudioResult> {
    const json = await run(
      apiKey,
      req.model,
      { prompt: req.text, text: req.text, voice: req.voice },
      req.signal
    );
    const url = pickUrl(json);
    if (!url) throw new Error("fal.ai returned no audio");
    return { url, mimeType: "audio/mpeg", model: req.model };
  },
};

function aspectToSize(aspect?: string): string {
  switch (aspect) {
    case "16:9":
      return "landscape_16_9";
    case "9:16":
      return "portrait_16_9";
    case "1:1":
      return "square_hd";
    default:
      return "portrait_4_3";
  }
}
