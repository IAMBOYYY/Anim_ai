import { authHeader, chatCompletion, fetchJsonViaProxy, listOpenAICompatModels, type OpenAICompatConfig } from "./openai-compat";
import type { ModelInfo, ProviderAdapter, TextRequest, TextResult } from "./types";

const cfg: OpenAICompatConfig = {
  baseUrl: "https://openrouter.ai/api/v1",
  supports: ["text"],
};

async function validate(apiKey: string, signal?: AbortSignal) {
  await fetchJsonViaProxy("https://openrouter.ai/api/v1/models", { headers: authHeader(apiKey), signal }, { signal, retries: 1 });
  return { ok: true, message: "Key valid" };
}

async function listModels(apiKey: string, signal?: AbortSignal): Promise<ModelInfo[]> {
  const raw = (await fetchJsonViaProxy("https://openrouter.ai/api/v1/models", { headers: authHeader(apiKey), signal }, { signal, retries: 2 })) as {
    data?: { id: string; name?: string; architecture?: { input_modalities?: string[] } }[];
  };
  const out: ModelInfo[] = [];
  const seen = new Set<string>();
  for (const m of raw.data ?? []) {
    if (!m.id || seen.has(m.id)) continue;
    seen.add(m.id);
    const modal = m.architecture?.input_modalities ?? [];
    const caps: ModelInfo["capabilities"] = ["text"];
    out.push({ id: m.id, name: m.name || m.id, capabilities: caps, notes: modal.length ? `input: ${modal.join(", ")}` : undefined });
  }
  // Also merge the compat listing for consistency
  const merged = await listOpenAICompatModels(apiKey, cfg, signal).catch(() => [] as ModelInfo[]);
  for (const m of merged) if (!seen.has(m.id)) out.push(m);
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export const openrouter: ProviderAdapter = {
  id: "openrouter",
  name: "OpenRouter",
  tagline: "One key, hundreds of models with free variants",
  keyUrl: "https://openrouter.ai/keys",
  keyHint: "sk-or-…",
  capabilities: ["text"],
  keyPattern: /^sk-or-[A-Za-z0-9_-]{10,}$/,
  validate,
  listModels,
  text: (apiKey: string, req: TextRequest): Promise<TextResult> =>
    chatCompletion(
      apiKey,
      { ...cfg, headers: { "x-title": "AnimAI Studio" } },
      req
    ),
};
