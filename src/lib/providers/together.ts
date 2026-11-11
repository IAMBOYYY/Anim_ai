import { authHeader, chatCompletion, fetchJsonViaProxy, generateImageOpenAI, listOpenAICompatModels, type OpenAICompatConfig } from "./openai-compat";
import type { ImageRequest, ImageResult, ModelInfo, ProviderAdapter, TextRequest, TextResult } from "./types";

const cfg: OpenAICompatConfig = {
  baseUrl: "https://api.together.xyz/v1",
  supports: ["text", "image", "audio"],
};

async function validate(apiKey: string, signal?: AbortSignal) {
  await fetchJsonViaProxy("https://api.together.xyz/v1/models", { headers: authHeader(apiKey), signal }, { signal, retries: 1 });
  return { ok: true, message: "Key valid" };
}

async function listModels(apiKey: string, signal?: AbortSignal): Promise<ModelInfo[]> {
  return listOpenAICompatModels(apiKey, cfg, signal);
}

export const together: ProviderAdapter = {
  id: "together",
  name: "Together AI",
  tagline: "Open models for text, image & video",
  keyUrl: "https://api.together.ai/settings/api-keys",
  keyHint: "…(long hex)",
  capabilities: ["text", "image", "video"],
  validate,
  listModels,
  text: (apiKey: string, req: TextRequest): Promise<TextResult> => chatCompletion(apiKey, cfg, req),
  image: (apiKey: string, req: ImageRequest): Promise<ImageResult> => generateImageOpenAI(apiKey, cfg, req),
};
