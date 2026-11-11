import { classifyModel } from "./capabilities";
import { proxyFetch, readErrorDetail, readSSE, throwProviderError, withRetry, type RetryOptions } from "./http";
import type {
  AudioRequest,
  AudioResult,
  Capability,
  ImageRequest,
  ImageResult,
  ModelInfo,
  TextRequest,
  TextResult,
} from "./types";

export interface OpenAICompatConfig {
  baseUrl: string;
  /** extra headers, e.g. anthropic-version or provider-specific */
  headers?: Record<string, string>;
  /** models endpoint; defaults to `${baseUrl}/models` */
  modelsUrl?: string;
  /** map raw model payloads to ModelInfo */
  mapModels?: (raw: unknown) => ModelInfo[];
  supports?: Capability[];
  keyHeader?: "authorization" | "x-api-key";
}

export function authHeader(apiKey: string): Record<string, string> {
  return { authorization: `Bearer ${apiKey}` };
}

export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export function openAIModelsUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/models`;
}

interface OpenAIModelPayload {
  id: string;
  owned_by?: string;
}

export function defaultMapModels(raw: unknown, supports: Capability[] = ["text"]): ModelInfo[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { data?: unknown })?.data)
      ? ((raw as { data: unknown[] }).data as unknown[])
      : [];
  const seen = new Set<string>();
  const out: ModelInfo[] = [];
  for (const item of list as OpenAIModelPayload[]) {
    if (!item || typeof item.id !== "string" || seen.has(item.id)) continue;
    seen.add(item.id);
    const caps = classifyModel(item.id, []);
    // Provider declares generation caps; keep only those that apply.
    const capabilities = caps.filter((c) => supports.includes(c));
    out.push({
      id: item.id,
      name: item.id,
      capabilities: capabilities.length ? capabilities : ["text"],
      notes: item.owned_by,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export async function fetchJsonViaProxy(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
  retry?: RetryOptions
): Promise<unknown> {
  const run = async () => {
    const res = await proxyFetch(url, { ...init, signal: retry?.signal ?? init.signal });
    if (!res.ok) throwProviderError(res, await readErrorDetail(res));
    return res.json() as Promise<unknown>;
  };
  if (retry) return withRetry(() => run(), retry);
  return run();
}

export async function listOpenAICompatModels(
  apiKey: string,
  cfg: OpenAICompatConfig,
  signal?: AbortSignal
): Promise<ModelInfo[]> {
  const url = cfg.modelsUrl ?? openAIModelsUrl(cfg.baseUrl);
  const raw = await fetchJsonViaProxy(
    url,
    { headers: { ...authHeader(apiKey), ...cfg.headers }, signal },
    { signal, retries: 2 }
  );
  const mapped = cfg.mapModels ? cfg.mapModels(raw) : defaultMapModels(raw, cfg.supports ?? ["text"]);
  return mapped;
}

export async function chatCompletion(
  apiKey: string,
  cfg: OpenAICompatConfig,
  req: TextRequest
): Promise<TextResult> {
  const url = `${normalizeBaseUrl(cfg.baseUrl)}/chat/completions`;
  const body = {
    model: req.model,
    messages: [
      ...(req.system ? [{ role: "system", content: req.system }] : []),
      { role: "user", content: req.prompt },
    ],
    max_tokens: req.maxTokens ?? 4096,
    temperature: req.temperature ?? 0.8,
    stream: Boolean(req.stream),
  };

  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...authHeader(apiKey),
    ...cfg.headers,
  };

  const doFetch = () => proxyFetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: req.signal });

  if (!req.stream) {
    const json = (await withRetry(async () => {
      const res = await doFetch();
      if (!res.ok) throwProviderError(res, await readErrorDetail(res));
      return res.json() as Promise<Record<string, unknown>>;
    }, { signal: req.signal, retries: 2 })) as {
      choices?: { message?: { content?: string | null } }[];
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = json.choices?.[0]?.message?.content ?? "";
    return {
      text,
      model: json.model ?? req.model,
      usage: {
        inputTokens: json.usage?.prompt_tokens,
        outputTokens: json.usage?.completion_tokens,
      },
    };
  }

  const res = await doFetch();
  if (!res.ok) throwProviderError(res, await readErrorDetail(res));

  let text = "";
  await readSSE(
    res,
    (data) => {
      try {
        const json = JSON.parse(data) as {
          choices?: { delta?: { content?: string | null } }[];
        };
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          text += delta;
          req.stream?.(delta);
        }
      } catch {
        /* ignore partial frames */
      }
    },
    req.signal
  );
  return { text, model: req.model };
}

export async function generateImageOpenAI(
  apiKey: string,
  cfg: OpenAICompatConfig,
  req: ImageRequest
): Promise<ImageResult> {
  const url = `${normalizeBaseUrl(cfg.baseUrl)}/images/generations`;
  const body: Record<string, unknown> = {
    model: req.model,
    prompt: req.prompt,
    n: req.n ?? 1,
    size: sizeForAspect(req.aspectRatio),
    response_format: "b64_json",
  };
  const json = (await withRetry(async () => {
    const res = await proxyFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader(apiKey), ...cfg.headers },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) throwProviderError(res, await readErrorDetail(res));
    return res.json() as Promise<Record<string, unknown>>;
  }, { signal: req.signal, retries: 1 })) as { data?: { b64_json?: string; url?: string }[] };

  const first = json.data?.[0];
  if (!first?.b64_json && !first?.url) throw new Error("Image provider returned no image data");
  return { b64: first.b64_json, url: first.url, mimeType: "image/png", model: req.model };
}

export async function speechOpenAI(
  apiKey: string,
  cfg: OpenAICompatConfig,
  req: AudioRequest
): Promise<AudioResult> {
  const url = `${normalizeBaseUrl(cfg.baseUrl)}/audio/speech`;
  const res = await withRetry(
    async () => {
      const r = await proxyFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeader(apiKey), ...cfg.headers },
        body: JSON.stringify({
          model: req.model,
          input: req.text,
          voice: req.voice ?? "alloy",
          response_format: req.format ?? "mp3",
        }),
        signal: req.signal,
      });
      if (!r.ok) throwProviderError(r, await readErrorDetail(r));
      return r;
    },
    { signal: req.signal, retries: 1 }
  );

  const buf = await res.arrayBuffer();
  const mime = res.headers.get("content-type") || "audio/mpeg";
  return { b64: arrayBufferToBase64(buf), mimeType: mime, model: req.model };
}

function sizeForAspect(aspect?: string): string {
  switch (aspect) {
    case "16:9":
      return "1792x1024";
    case "9:16":
      return "1024x1792";
    case "1:1":
      return "1024x1024";
    default:
      return "1024x1536";
  }
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  if (typeof btoa === "function") return btoa(binary);
  // Node fallback (build/tests)
  return Buffer.from(bytes).toString("base64");
}

export function stripDataUrl(b64: string): string {
  return b64.replace(/^data:[^;]+;base64,/, "");
}

/** Pull a JSON object out of a model response (handles ```json fences & prose). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("No JSON object found in model output");
  return JSON.parse(candidate.slice(start, end + 1));
}
