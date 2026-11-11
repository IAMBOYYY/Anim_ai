import { proxyFetch, readErrorDetail, throwProviderError, withRetry } from "./http";
import { arrayBufferToBase64 } from "./openai-compat";
import type {
  AudioRequest,
  AudioResult,
  ModelInfo,
  ProviderAdapter,
} from "./types";

const BASE = "https://api.elevenlabs.io/v1";

function headers(apiKey: string): Record<string, string> {
  return { "xi-api-key": apiKey, "content-type": "application/json", accept: "audio/mpeg" };
}

async function validate(apiKey: string, signal?: AbortSignal) {
  const json = (await withRetry(
    async () => {
      const r = await proxyFetch(`${BASE}/voices`, { headers: headers(apiKey), signal });
      if (!r.ok) throwProviderError(r, await readErrorDetail(r));
      return r.json() as Promise<{ voices?: { name?: string }[] }>;
    },
    { signal, retries: 1 }
  )) as { voices?: { name?: string }[] };
  return { ok: true, message: `Key valid — ${json.voices?.length ?? 0} voices` };
}

async function listModels(apiKey: string, signal?: AbortSignal): Promise<ModelInfo[]> {
  const json = (await withRetry(
    async () => {
      const r = await proxyFetch(`${BASE}/models`, { headers: headers(apiKey), signal });
      if (!r.ok) throwProviderError(r, await readErrorDetail(r));
      return r.json() as Promise<unknown>;
    },
    { signal, retries: 2 }
  )) as { model_id?: string; name?: string; description?: string }[];

  const list = Array.isArray(json) ? json : [];
  const models: ModelInfo[] = list
    .filter((m) => m.model_id)
    .map((m) => ({
      id: m.model_id as string,
      name: m.name || (m.model_id as string),
      capabilities: ["audio" as const],
      notes: m.description?.slice(0, 80),
    }));

  const voices = await proxyFetch(`${BASE}/voices`, { headers: headers(apiKey), signal }).catch(() => null);
  if (voices?.ok) {
    const v = (await voices.json()) as { voices?: { voice_id?: string; name?: string; category?: string }[] };
    for (const voice of v.voices ?? []) {
      if (!voice.voice_id) continue;
      models.push({
        id: `voice:${voice.voice_id}`,
        name: `${voice.name ?? voice.voice_id}${voice.category ? ` (${voice.category})` : ""}`,
        capabilities: ["audio"],
        notes: "voice preset — use as the voice for any TTS model",
      });
    }
  }

  if (!models.some((m) => m.id === "eleven_multilingual_v2")) {
    models.push({ id: "eleven_multilingual_v2", name: "Multilingual v2", capabilities: ["audio"] });
  }
  return models;
}

export const elevenlabs: ProviderAdapter = {
  id: "elevenlabs",
  name: "ElevenLabs",
  tagline: "Best-in-class TTS, voice cloning & sound effects",
  keyUrl: "https://elevenlabs.io/app/settings/api-keys",
  keyHint: "…",
  capabilities: ["audio"],
  validate,
  listModels,

  async audio(apiKey, req: AudioRequest): Promise<AudioResult> {
    let modelId = req.model;
    let voice = req.voice;
    if (modelId.startsWith("voice:")) {
      voice = modelId.slice("voice:".length);
      modelId = "eleven_multilingual_v2";
    }
    const voiceId = voice && !voice.startsWith("voice:") ? voice : voice?.startsWith("voice:") ? voice.slice(6) : "21m00Tcm4TlvDq8ikWAM";

    const r = await withRetry(
      async () => {
        const res = await proxyFetch(`${BASE}/text-to-speech/${voiceId}`, {
          method: "POST",
          headers: headers(apiKey),
          body: JSON.stringify({
            text: req.text,
            model_id: modelId,
            voice_settings: { stability: 0.5, similarity_boost: 0.75 },
          }),
          signal: req.signal,
        });
        if (!res.ok) throwProviderError(res, await readErrorDetail(res));
        return res;
      },
      { signal: req.signal, retries: 1 }
    );
    const buf = await r.arrayBuffer();
    return { b64: arrayBufferToBase64(buf), mimeType: "audio/mpeg", model: modelId };
  },
};
