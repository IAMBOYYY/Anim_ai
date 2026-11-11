import { authHeader, chatCompletion, fetchJsonViaProxy, listOpenAICompatModels, type OpenAICompatConfig } from "./openai-compat";
import type { ModelInfo, ProviderAdapter, TextRequest, TextResult } from "./types";

const cfg: OpenAICompatConfig = {
  baseUrl: "https://api.mistral.ai/v1",
  supports: ["text"],
};

async function validate(apiKey: string, signal?: AbortSignal) {
  await fetchJsonViaProxy("https://api.mistral.ai/v1/models", { headers: authHeader(apiKey), signal }, { signal, retries: 1 });
  return { ok: true, message: "Key valid" };
}

async function listModels(apiKey: string, signal?: AbortSignal): Promise<ModelInfo[]> {
  return listOpenAICompatModels(apiKey, cfg, signal);
}

export const mistral: ProviderAdapter = {
  id: "mistral",
  name: "Mistral",
  tagline: "European open & frontier models",
  keyUrl: "https://console.mistral.ai/api-keys",
  keyHint: "…",
  capabilities: ["text"],
  validate,
  listModels,
  text: (apiKey: string, req: TextRequest): Promise<TextResult> => chatCompletion(apiKey, cfg, req),
};
