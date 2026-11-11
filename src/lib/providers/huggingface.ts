import { authHeader, chatCompletion, fetchJsonViaProxy, listOpenAICompatModels, type OpenAICompatConfig } from "./openai-compat";
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
} from "./types";

const cfg: OpenAICompatConfig = {
  baseUrl: "https://router.huggingface.co/v1",
  supports: ["text", "image", "audio"],
};

const WHOAMI = "https://huggingface.co/api/whoami-v2";

async function validate(apiKey: string, signal?: AbortSignal) {
  const json = (await fetchJsonViaProxy(WHOAMI, { headers: authHeader(apiKey), signal }, { signal, retries: 1 })) as {
    name?: string;
  };
  return { ok: true, message: `Key valid — ${json.name ?? "user"}` };
}

async function listModels(apiKey: string, signal?: AbortSignal): Promise<ModelInfo[]> {
  const router = await listOpenAICompatModels(apiKey, cfg, signal).catch(() => [] as ModelInfo[]);
  const curated: ModelInfo[] = [
    { id: "meta-llama/Llama-3.3-70B-Instruct", name: "Llama 3.3 70B", capabilities: ["text"] },
    { id: "Qwen/Qwen2.5-72B-Instruct", name: "Qwen 2.5 72B", capabilities: ["text"] },
    { id: "stabilityai/stable-diffusion-xl-base-1.0", name: "SDXL 1.0", capabilities: ["image"] },
    { id: "black-forest-labs/FLUX.1-dev", name: "FLUX.1 dev", capabilities: ["image"] },
    { id: "microsoft/Florence-2-large", name: "Florence-2", capabilities: ["image", "text"] },
    { id: "openai/whisper-large-v3-turbo", name: "Whisper v3 Turbo", capabilities: ["audio"] },
  ];
  const seen = new Set(router.map((m) => m.id));
  for (const c of curated) if (!seen.has(c.id)) router.push(c);
  return router;
}

export const huggingface: ProviderAdapter = {
  id: "huggingface",
  name: "Hugging Face",
  tagline: "Inference Providers — thousands of open models",
  keyUrl: "https://huggingface.co/settings/tokens/new?tokenType=granular",
  keyHint: "hf_…",
  capabilities: ["text", "image", "audio", "video"],
  keyPattern: /^hf_[A-Za-z0-9]{10,}$/,
  validate,
  listModels,

  async text(apiKey, req: TextRequest): Promise<TextResult> {
    return chatCompletion(apiKey, cfg, req);
  },

  async image(apiKey, req: ImageRequest): Promise<ImageResult> {
    const model = req.model;
    const isRouterChat = model.includes("/") && !model.includes("stable-diffusion") && !model.includes("FLUX");
    if (isRouterChat && !model.toLowerCase().includes("image")) {
      // fall back to chat-based generation prompt
      const res = await chatCompletion(apiKey, cfg, {
        model,
        prompt: `Generate an image: ${req.prompt}`,
        maxTokens: 512,
        signal: req.signal,
      });
      const match = res.text.match(/https?:\/\/\S+\.(png|jpg|jpeg|webp)/i);
      if (match) return { url: match[0], mimeType: "image/png", model };
      throw new Error("Model did not return an image URL — pick an image-generation model");
    }
    const url = model.startsWith("https://") ? model : `https://router.huggingface.co/${model}`;
    const out = await withRetry(
      async () => {
        const r = await proxyFetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", ...authHeader(apiKey) },
          body: JSON.stringify({ inputs: req.prompt, parameters: { aspect_ratio: req.aspectRatio ?? "2:3" } }),
          signal: req.signal,
        });
        if (!r.ok) throwProviderError(r, await readErrorDetail(r));
        const ct = r.headers.get("content-type") || "";
        if (ct.startsWith("image/")) {
          const buf = await r.arrayBuffer();
          return { b64: arrayBufferToBase64(buf), mimeType: ct, model };
        }
        const json = (await r.json()) as { image?: string; url?: string; data?: { url?: string }[] };
        const img = json.image || json.url || json.data?.[0]?.url;
        if (!img) throw new Error("No image returned");
        if (img.startsWith("data:")) {
          return { b64: img.split(",")[1], mimeType: img.slice(5, img.indexOf(";")), model };
        }
        return { url: img, mimeType: "image/png", model };
      },
      { signal: req.signal, retries: 1 }
    );
    return out;
  },

  async audio(apiKey, req: AudioRequest): Promise<AudioResult> {
    const url = req.model.startsWith("https://") ? req.model : `https://router.huggingface.co/${req.model}`;
    const r = await withRetry(
      async () => {
        const res = await proxyFetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", ...authHeader(apiKey) },
          body: JSON.stringify({ inputs: req.text, parameters: { return_audio: true } }),
          signal: req.signal,
        });
        if (!res.ok) throwProviderError(res, await readErrorDetail(res));
        return res;
      },
      { signal: req.signal, retries: 1 }
    );
    const ct = r.headers.get("content-type") || "audio/mpeg";
    if (ct.startsWith("audio/") || ct.includes("octet")) {
      const buf = await r.arrayBuffer();
      return { b64: arrayBufferToBase64(buf), mimeType: ct.split(";")[0], model: req.model };
    }
    const json = (await r.json().catch(() => null)) as { audio?: string; url?: string } | null;
    if (json?.audio) return { b64: json.audio.split(",").pop(), mimeType: "audio/mpeg", model: req.model };
    if (json?.url) return { url: json.url, mimeType: "audio/mpeg", model: req.model };
    throw new Error("No audio returned — pick a TTS/audio model");
  },
};
