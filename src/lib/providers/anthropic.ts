import { proxyFetch, readErrorDetail, readSSE, throwProviderError, withRetry } from "./http";
import type {
  ModelInfo,
  ProviderAdapter,
  TextRequest,
  TextResult,
} from "./types";

const BASE = "https://api.anthropic.com/v1";
const VERSION = "2023-06-01";

function headers(apiKey: string): Record<string, string> {
  return { "x-api-key": apiKey, "anthropic-version": VERSION, "content-type": "application/json" };
}

async function validate(apiKey: string, signal?: AbortSignal) {
  await fetchModels(apiKey, signal);
  return { ok: true, message: "Key valid" };
}

async function fetchModels(apiKey: string, signal?: AbortSignal) {
  const res = await withRetry(
    async () => {
      const r = await proxyFetch(`${BASE}/models?limit=100`, { headers: headers(apiKey), signal });
      if (!r.ok) throwProviderError(r, await readErrorDetail(r));
      return r;
    },
    { signal, retries: 2 }
  );
  return res.json() as Promise<{ data?: { id: string; display_name?: string; context_window?: number }[] }>;
}

async function listModels(apiKey: string, signal?: AbortSignal): Promise<ModelInfo[]> {
  const json = await fetchModels(apiKey, signal);
  return (json.data ?? []).map((m) => ({
    id: m.id,
    name: m.display_name || m.id,
    capabilities: ["text" as const],
    contextWindow: m.context_window,
  }));
}

async function text(apiKey: string, req: TextRequest): Promise<TextResult> {
  const body = {
    model: req.model,
    max_tokens: req.maxTokens ?? 4096,
    temperature: req.temperature ?? 0.8,
    ...(req.system ? { system: req.system } : {}),
    messages: [{ role: "user", content: req.prompt }],
    stream: Boolean(req.stream),
  };

  if (req.stream) {
    const res = await proxyFetch(`${BASE}/messages`, {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) throwProviderError(res, await readErrorDetail(res));
    let out = "";
    await readSSE(
      res,
      (data) => {
        try {
          const json = JSON.parse(data) as { type?: string; delta?: { text?: string } };
          if (json.type === "content_block_delta" && json.delta?.text) {
            out += json.delta.text;
            req.stream?.(json.delta.text);
          }
        } catch {
          /* skip */
        }
      },
      req.signal
    );
    return { text: out, model: req.model };
  }

  const json = (await withRetry(async () => {
    const res = await proxyFetch(`${BASE}/messages`, {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) throwProviderError(res, await readErrorDetail(res));
    return res.json() as Promise<Record<string, unknown>>;
  }, { signal: req.signal, retries: 2 })) as {
    content?: { type: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
    model?: string;
  };

  const text = (json.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  return {
    text,
    model: json.model ?? req.model,
    usage: { inputTokens: json.usage?.input_tokens, outputTokens: json.usage?.output_tokens },
  };
}

export const anthropic: ProviderAdapter = {
  id: "anthropic",
  name: "Anthropic",
  tagline: "Claude models for writing & planning",
  keyUrl: "https://console.anthropic.com/settings/keys",
  keyHint: "sk-ant-…",
  capabilities: ["text"],
  keyPattern: /^sk-ant-[A-Za-z0-9_-]{10,}$/,
  validate,
  listModels,
  text,
};
