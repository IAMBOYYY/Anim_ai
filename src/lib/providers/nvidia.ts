import { authHeader, chatCompletion, fetchJsonViaProxy, generateImageOpenAI, listOpenAICompatModels, type OpenAICompatConfig } from "./openai-compat";
import type { ImageRequest, ImageResult, ModelInfo, ProviderAdapter, TextRequest, TextResult } from "./types";

const cfg: OpenAICompatConfig = {
  baseUrl: "https://integrate.api.nvidia.com/v1",
  supports: ["text", "image"],
};

async function validate(apiKey: string, signal?: AbortSignal) {
  await fetchJsonViaProxy("https://integrate.api.nvidia.com/v1/models", { headers: authHeader(apiKey), signal }, { signal, retries: 1 });
  return { ok: true, message: "Key valid" };
}

async function listModels(apiKey: string, signal?: AbortSignal): Promise<ModelInfo[]> {
  return listOpenAICompatModels(apiKey, cfg, signal);
}

export const nvidia: ProviderAdapter = {
  id: "nvidia",
  name: "NVIDIA NIM",
  tagline: "NIM microservices — LLMs & image models",
  keyUrl: "https://build.nvidia.com/nimkeys",
  keyHint: "nvapi-…",
  capabilities: ["text", "image"],
  keyPattern: /^nvapi-[A-Za-z0-9_-]{10,}$/,
  validate,
  listModels,
  text: (apiKey: string, req: TextRequest): Promise<TextResult> => chatCompletion(apiKey, cfg, req),
  image: (apiKey: string, req: ImageRequest): Promise<ImageResult> => generateImageOpenAI(apiKey, { ...cfg, baseUrl: cfg.baseUrl }, req),
};
