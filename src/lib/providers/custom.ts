import { authHeader, chatCompletion, fetchJsonViaProxy, generateImageOpenAI, listOpenAICompatModels, normalizeBaseUrl, speechOpenAI, type OpenAICompatConfig } from "./openai-compat";
import type { ImageRequest, ImageResult, ModelInfo, ProviderAdapter, TextRequest, TextResult, AudioRequest, AudioResult } from "./types";

/**
 * User-defined OpenAI-compatible endpoint.
 * baseUrl + key are stored per-user in settings (key encrypted like other keys).
 */
export const CUSTOM_BASE_URL_KEY = "customBaseUrl";

export function customAdapter(baseUrl: string): ProviderAdapter {
  const normalized = normalizeBaseUrl(baseUrl || "");
  const cfg: OpenAICompatConfig = { baseUrl: normalized, supports: ["text", "image", "audio"] };

  return {
    id: "custom",
    name: "Custom (OpenAI-compatible)",
    tagline: "Any endpoint that speaks the OpenAI API dialect",
    keyUrl: "https://",
    keyHint: "any token",
    capabilities: ["text", "image", "audio"],

    async validate(apiKey, signal) {
      if (!normalized) throw new Error("Set a Base URL first (Settings → Custom)");
      await fetchJsonViaProxy(`${normalized}/models`, { headers: authHeader(apiKey), signal }, { signal, retries: 1 });
      return { ok: true, message: "Key valid" };
    },

    async listModels(apiKey, signal): Promise<ModelInfo[]> {
      if (!normalized) return [];
      return listOpenAICompatModels(apiKey, cfg, signal);
    },

    text(apiKey: string, req: TextRequest): Promise<TextResult> {
      if (!normalized) throw new Error("Custom base URL is not configured");
      return chatCompletion(apiKey, cfg, req);
    },

    image(apiKey: string, req: ImageRequest): Promise<ImageResult> {
      if (!normalized) throw new Error("Custom base URL is not configured");
      return generateImageOpenAI(apiKey, cfg, req);
    },

    audio(apiKey: string, req: AudioRequest): Promise<AudioResult> {
      if (!normalized) throw new Error("Custom base URL is not configured");
      return speechOpenAI(apiKey, cfg, req);
    },
  };
}
