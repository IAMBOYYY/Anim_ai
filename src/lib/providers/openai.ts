import { chatCompletion, fetchJsonViaProxy, generateImageOpenAI, listOpenAICompatModels, speechOpenAI, type OpenAICompatConfig } from "./openai-compat";
import { authHeader } from "./openai-compat";
import type { ProviderAdapter, ModelInfo, TextRequest, TextResult, ImageRequest, ImageResult, AudioRequest, AudioResult } from "./types";

const cfg: OpenAICompatConfig = {
  baseUrl: "https://api.openai.com/v1",
  supports: ["text", "image", "audio"],
};

async function validate(apiKey: string, signal?: AbortSignal) {
  const raw = await fetchJsonViaProxy("https://api.openai.com/v1/models", { headers: authHeader(apiKey), signal }, { signal, retries: 1 });
  const count = Array.isArray((raw as { data?: unknown[] })?.data) ? (raw as { data: unknown[] }).data.length : 0;
  return { ok: true, message: `Key valid — ${count} models visible` };
}

async function listModels(apiKey: string, signal?: AbortSignal): Promise<ModelInfo[]> {
  const models = await listOpenAICompatModels(apiKey, cfg, signal);
  // OpenAI: media generation models aren't all in /models; add known generators.
  const extra: ModelInfo[] = [
    { id: "gpt-image-1", name: "GPT Image 1", capabilities: ["image"] },
    { id: "dall-e-3", name: "DALL·E 3", capabilities: ["image"] },
    { id: "dall-e-2", name: "DALL·E 2", capabilities: ["image"] },
    { id: "tts-1", name: "TTS-1", capabilities: ["audio"] },
    { id: "tts-1-hd", name: "TTS-1 HD", capabilities: ["audio"] },
    { id: "sora-2", name: "Sora 2", capabilities: ["video"] },
  ];
  const seen = new Set(models.map((m) => m.id));
  for (const e of extra) if (!seen.has(e.id)) models.push(e);
  return models;
}

export const openai: ProviderAdapter = {
  id: "openai",
  name: "OpenAI",
  tagline: "GPT, DALL·E, TTS and Sora",
  keyUrl: "https://platform.openai.com/api-keys",
  keyHint: "sk-…",
  capabilities: ["text", "image", "audio", "video"],
  keyPattern: /^sk-[A-Za-z0-9_-]{10,}$/,
  validate,
  listModels,
  text: (apiKey: string, req: TextRequest): Promise<TextResult> => chatCompletion(apiKey, cfg, req),
  image: (apiKey: string, req: ImageRequest): Promise<ImageResult> => generateImageOpenAI(apiKey, cfg, req),
  audio: (apiKey: string, req: AudioRequest): Promise<AudioResult> => speechOpenAI(apiKey, cfg, req),
};
