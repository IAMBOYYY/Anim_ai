import { authHeader, chatCompletion, listOpenAICompatModels, speechOpenAI, type OpenAICompatConfig } from "./openai-compat";
import { fetchJsonViaProxy } from "./openai-compat";
import type { AudioRequest, AudioResult, ModelInfo, ProviderAdapter, TextRequest, TextResult } from "./types";

const cfg: OpenAICompatConfig = {
  baseUrl: "https://api.groq.com/openai/v1",
  supports: ["text", "audio"],
};

async function validate(apiKey: string, signal?: AbortSignal) {
  await fetchJsonViaProxy("https://api.groq.com/openai/v1/models", { headers: authHeader(apiKey), signal }, { signal, retries: 1 });
  return { ok: true, message: "Key valid" };
}

async function listModels(apiKey: string, signal?: AbortSignal): Promise<ModelInfo[]> {
  const models = await listOpenAICompatModels(apiKey, cfg, signal);
  const extras: ModelInfo[] = [
    { id: "playai-tts", name: "PlayAI TTS", capabilities: ["audio"] },
    { id: "playai-tts-v2", name: "PlayAI TTS v2", capabilities: ["audio"] },
    { id: "whisper-large-v3-turbo", name: "Whisper Large v3 Turbo", capabilities: ["audio"] },
  ];
  const seen = new Set(models.map((m) => m.id));
  for (const e of extras) if (!seen.has(e.id)) models.push(e);
  return models;
}

export const groq: ProviderAdapter = {
  id: "groq",
  name: "Groq",
  tagline: "Blazing-fast LPU inference — generous free tier",
  keyUrl: "https://console.groq.com/keys",
  keyHint: "gsk_…",
  capabilities: ["text", "audio"],
  keyPattern: /^gsk_[A-Za-z0-9]{10,}$/,
  validate,
  listModels,
  text: (apiKey: string, req: TextRequest): Promise<TextResult> => chatCompletion(apiKey, cfg, req),
  audio: async (apiKey: string, req: AudioRequest): Promise<AudioResult> => {
    if (req.model.includes("whisper")) throw new Error("Whisper models are for speech-to-text; pick a TTS model (playai-tts)");
    return speechOpenAI(apiKey, { ...cfg, baseUrl: cfg.baseUrl }, { ...req, voice: req.voice ?? "Fritz-PlayAI" });
  },
};
