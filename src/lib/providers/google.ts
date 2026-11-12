import { fetchJsonViaProxy } from "./openai-compat";
import { proxyFetch, readErrorDetail, readSSE, throwProviderError, withRetry } from "./http";
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
import { classifyModel } from "./capabilities";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

interface RawModel {
  name: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
  inputTokenLimit?: number;
}

function keyQuery(apiKey: string): string {
  return `key=${encodeURIComponent(apiKey)}`;
}

async function validate(apiKey: string, signal?: AbortSignal) {
  await fetchJsonViaProxy(`${BASE}/models?pageSize=1&${keyQuery(apiKey)}`, { signal }, { signal, retries: 1 });
  return { ok: true, message: "Key valid" };
}

async function listModels(apiKey: string, signal?: AbortSignal): Promise<ModelInfo[]> {
  const raw = (await fetchJsonViaProxy(`${BASE}/models?pageSize=200&${keyQuery(apiKey)}`, { signal }, { signal, retries: 2 })) as {
    models?: RawModel[];
  };
  const out: ModelInfo[] = [];
  for (const m of raw.models ?? []) {
    const id = m.name.replace(/^models\//, "");
    const methods = m.supportedGenerationMethods ?? [];
    if (methods.length && !methods.includes("generateContent")) continue;
    let capabilities = classifyModel(id, []);
    if (id.includes("tts")) capabilities = ["audio"];
    if (id.includes("image")) capabilities = capabilities.includes("text") ? [...capabilities] : capabilities;
    out.push({
      id,
      name: m.displayName || id,
      capabilities: capabilities.includes("text") || capabilities.length ? capabilities : ["text"],
      contextWindow: m.inputTokenLimit,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function contents(prompt: string, system?: string) {
  return {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  };
}

async function generateContent(
  apiKey: string,
  model: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
  stream?: (delta: string) => void
): Promise<{ text: string; parts: unknown[] }> {
  if (stream) {
    const url = `${BASE}/models/${model}:streamGenerateContent?alt=sse&${keyQuery(apiKey)}`;
    const res = await proxyFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throwProviderError(res, await readErrorDetail(res));
    let text = "";
    await readSSE(
      res,
      (data) => {
        try {
          const json = JSON.parse(data) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
          const parts = json.candidates?.[0]?.content?.parts ?? [];
          for (const p of parts) {
            if (p.text) {
              text += p.text;
              stream(p.text);
            }
          }
        } catch {
          /* skip */
        }
      },
      signal
    );
    return { text, parts: [] };
  }

  const url = `${BASE}/models/${model}:generateContent?${keyQuery(apiKey)}`;
  const json = (await withRetry(async () => {
    const res = await proxyFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throwProviderError(res, await readErrorDetail(res));
    return res.json() as Promise<Record<string, unknown>>;
  }, { signal, retries: 2 })) as {
    candidates?: { content?: { parts?: { text?: string; inlineData?: { data?: string; mimeType?: string } }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };

  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? "").join("");
  return { text, parts: parts as unknown[] };
}

export const google: ProviderAdapter = {
  id: "google",
  name: "Google Gemini",
  tagline: "Gemini 2.x multimodal — text, image & TTS",
  keyUrl: "https://aistudio.google.com/apikey",
  keyHint: "AIza…",
  capabilities: ["text", "image", "audio"],
  keyPattern: /^AIza[A-Za-z0-9_-]{10,}$/,
  validate,
  listModels,

  async text(apiKey, req: TextRequest): Promise<TextResult> {
    const { text } = await generateContent(
      apiKey,
      req.model,
      {
        ...contents(req.prompt, req.system),
        generationConfig: { maxOutputTokens: req.maxTokens ?? 4096, temperature: req.temperature ?? 0.8 },
      },
      req.signal,
      req.stream
    );
    return { text, model: req.model };
  },

  async image(apiKey, req: ImageRequest): Promise<ImageResult> {
    const model = req.model.includes("-image") || req.model.includes("image") ? req.model : req.model;
    const { parts } = await generateContent(
      apiKey,
      model,
      {
        contents: [{ role: "user", parts: [{ text: `${req.prompt}. Aspect ratio: ${req.aspectRatio ?? "2:3"}.` }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      },
      req.signal
    );
    for (const raw of parts as { inlineData?: { data?: string; mimeType?: string } }[]) {
      if (raw.inlineData?.data) {
        return { b64: raw.inlineData.data, mimeType: raw.inlineData.mimeType || "image/png", model };
      }
    }
    throw new Error("Gemini returned no image data — pick an image-capable model (e.g. gemini-2.0-flash-preview-image-generation)");
  },

  async audio(apiKey, req: AudioRequest): Promise<AudioResult> {
    const model = req.model.includes("tts") ? req.model : "gemini-2.5-flash-preview-tts";
    const { parts } = await generateContent(
      apiKey,
      model,
      {
        contents: [{ role: "user", parts: [{ text: req.text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: req.voice || "Kore" } } },
        },
      },
      req.signal
    );
    for (const raw of parts as { inlineData?: { data?: string; mimeType?: string } }[]) {
      if (raw.inlineData?.data) {
        return { b64: raw.inlineData.data, mimeType: raw.inlineData.mimeType || "audio/wav", model };
      }
    }
    throw new Error("Gemini returned no audio data — pick a TTS model (e.g. gemini-2.5-flash-preview-tts)");
  },
};
