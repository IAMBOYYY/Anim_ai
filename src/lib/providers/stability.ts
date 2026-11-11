import { proxyFetch, readErrorDetail, throwProviderError, withRetry } from "./http";
import { arrayBufferToBase64 } from "./openai-compat";
import type {
  ImageRequest,
  ImageResult,
  ModelInfo,
  ProviderAdapter,
  VideoRequest,
  VideoResult,
} from "./types";

const BASE = "https://api.stability.ai";

function headers(apiKey: string): Record<string, string> {
  return { authorization: `Bearer ${apiKey}`, accept: "application/json" };
}

async function validate(apiKey: string, signal?: AbortSignal) {
  const json = (await withRetry(
    async () => {
      const r = await proxyFetch(`${BASE}/v1/user/account`, { headers: headers(apiKey), signal });
      if (!r.ok) throwProviderError(r, await readErrorDetail(r));
      return r.json() as Promise<{ organization?: { name?: string } }>;
    },
    { signal, retries: 1 }
  )) as { organization?: { name?: string } };
  return { ok: true, message: `Key valid — ${json.organization?.name ?? "account"}` };
}

const CURATED: ModelInfo[] = [
  { id: "stable-image/core", name: "Stable Image Core", capabilities: ["image"], notes: "Fast, high quality" },
  { id: "stable-image/ultra", name: "Stable Image Ultra", capabilities: ["image"], notes: "Highest quality" },
  { id: "stable-diffusion-3.5-large", name: "SD 3.5 Large", capabilities: ["image"] },
  { id: "sd3-medium", name: "SD3 Medium", capabilities: ["image"] },
  { id: "stable-video-diffusion", name: "Stable Video Diffusion", capabilities: ["video"] },
];

async function listModels(apiKey: string, signal?: AbortSignal): Promise<ModelInfo[]> {
  try {
    const r = await proxyFetch(`${BASE}/v1/models`, { headers: headers(apiKey), signal });
    if (r.ok) {
      const json = (await r.json()) as { models?: { id?: string; name?: string; description?: string }[] };
      const out = (json.models ?? [])
        .filter((m) => m.id)
        .map((m) => ({
          id: m.id as string,
          name: m.name || (m.id as string),
          capabilities: classifyStability(m.id as string),
          notes: m.description?.slice(0, 80),
        }));
      if (out.length) return out;
    }
  } catch {
    /* curated fallback */
  }
  return CURATED;
}

function classifyStability(id: string): ModelInfo["capabilities"] {
  const s = id.toLowerCase();
  if (s.includes("video") || s.includes("svd")) return ["video"];
  return ["image"];
}

export const stability: ProviderAdapter = {
  id: "stability",
  name: "Stability AI",
  tagline: "Stable Diffusion, Stable Image & video",
  keyUrl: "https://platform.stability.ai/account/keys",
  keyHint: "sk-…",
  capabilities: ["image", "video"],
  keyPattern: /^sk-[A-Za-z0-9]{10,}$/,
  validate,
  listModels,

  async image(apiKey, req: ImageRequest): Promise<ImageResult> {
    const model = req.model || "stable-image/core";
    const isV2 = model.startsWith("stable-diffusion") || model.startsWith("sd");

    if (isV2) {
      const form = new URLSearchParams();
      form.set("prompt", req.prompt);
      form.set("aspect_ratio", mapAspect(req.aspectRatio));
      form.set("output_format", "png");
      const r = await withRetry(
        async () => {
          const res = await proxyFetch(`${BASE}/v2beta/stable-image/generate/sd3`, {
            method: "POST",
            headers: { ...headers(apiKey), accept: "image/*" },
            body: form.toString(),
            signal: req.signal,
          });
          if (!res.ok) throwProviderError(res, await readErrorDetail(res));
          return res;
        },
        { signal: req.signal, retries: 1 }
      );
      const buf = await r.arrayBuffer();
      return { b64: arrayBufferToBase64(buf), mimeType: "image/png", model };
    }

    const form = new URLSearchParams();
    form.set("prompt", req.prompt);
    form.set("aspect_ratio", mapAspect(req.aspectRatio));
    form.set("output_format", "png");
    const endpoint = model === "stable-image/ultra" ? "ultra" : "core";
    const r = await withRetry(
      async () => {
        const res = await proxyFetch(`${BASE}/v2beta/stable-image/generate/${endpoint}`, {
          method: "POST",
          headers: { ...headers(apiKey), accept: "image/*" },
          body: form.toString(),
          signal: req.signal,
        });
        if (!res.ok) throwProviderError(res, await readErrorDetail(res));
        return res;
      },
      { signal: req.signal, retries: 1 }
    );
    const buf = await r.arrayBuffer();
    return { b64: arrayBufferToBase64(buf), mimeType: "image/png", model };
  },

  async video(apiKey, req: VideoRequest): Promise<VideoResult> {
    // Stable Video Diffusion: image-to-video only on this API — use text-to-video beta if available.
    const form = new URLSearchParams();
    form.set("prompt", req.prompt);
    form.set("aspect_ratio", mapAspect("16:9"));
    const r = await withRetry(
      async () => {
        const res = await proxyFetch(`${BASE}/v2beta/image-to-video`, {
          method: "POST",
          headers: { ...headers(apiKey), accept: "video/*" },
          body: form.toString(),
          signal: req.signal,
        });
        if (!res.ok) throwProviderError(res, await readErrorDetail(res));
        return res;
      },
      { signal: req.signal, retries: 0 }
    );
    const buf = await r.arrayBuffer();
    return { b64: arrayBufferToBase64(buf), mimeType: "video/mp4", model: req.model };
  },
};

function mapAspect(aspect?: string): string {
  switch (aspect) {
    case "16:9":
      return "16:9";
    case "9:16":
      return "9:16";
    case "1:1":
      return "1:1";
    default:
      return "2:3";
  }
}
