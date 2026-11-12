import { ProviderError } from "./types";

export const PROXY_PATH = "/api/proxy";

export interface ProxyRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface ProxyInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

/**
 * All provider traffic goes through the stateless /api/proxy route.
 * The key travels with the request and is never stored or logged server-side.
 */
export async function proxyFetch(
  input: string | { url: string; init?: ProxyInit },
  init?: ProxyInit
): Promise<Response> {
  const opts: { url: string; init: ProxyInit } =
    typeof input === "string" ? { url: input, init: init ?? {} } : { url: input.url, init: input.init ?? init ?? {} };

  const { method = "GET", headers = {}, body, signal } = opts.init;

  const payload: ProxyRequest = {
    url: opts.url,
    method,
    headers,
    ...(typeof body === "string" ? { body } : {}),
  };

  const res = await fetch(PROXY_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal,
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") || 0);
      throw new ProviderError(
      `Rate limited${retryAfter ? ` (retry after ${retryAfter}s)` : ""}. ${slice(text)}`,
        { status: 429, retryable: true, rateLimited: true }
      );
    }
    if (res.status >= 500) {
      throw new ProviderError(`Upstream error ${res.status}. ${slice(text)}`, {
        status: res.status,
        retryable: true,
      });
    }
    throw new ProviderError(`Request failed (${res.status}). ${slice(text)}`, {
      status: res.status,
      retryable: false,
    });
  }

  return res;
}

function slice(text: string, max = 400): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export interface RetryOptions {
  signal?: AbortSignal;
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (attempt: number, err: ProviderError, delayMs: number) => void;
}

/** Exponential backoff with jitter for rate limits / transient failures. */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  const base = opts.baseDelayMs ?? 800;
  const max = opts.maxDelayMs ?? 12000;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    opts.signal?.throwIfAborted?.();
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      const pe = err instanceof ProviderError ? err : null;
      const retryable = pe ? pe.retryable : false;
      if (!retryable || attempt === retries) break;
      const delay = Math.min(max, base * 2 ** attempt) * (0.6 + Math.random() * 0.6);
      opts.onRetry?.(attempt + 1, pe ?? new ProviderError(String(err)), Math.round(delay));
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, Math.round(delay));
        opts.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(t);
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true }
        );
      });
    }
  }
  throw lastErr;
}

export async function readErrorDetail(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    const msg =
      (json.error as { message?: string } | string | undefined) ??
      json.message ??
      json.detail;
    if (typeof msg === "string") return slice(msg);
    if (msg && typeof msg === "object" && "message" in msg) return slice(String((msg as { message: unknown }).message));
  } catch {
    /* not json */
  }
  return slice(text);
}

export function throwProviderError(res: Response, detail: string): never {
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError(`Invalid or unauthorized API key. ${detail}`, { status: res.status });
  }
  if (res.status === 402) {
    throw new ProviderError(`Insufficient credits. ${detail}`, { status: res.status });
  }
  if (res.status === 404) {
    throw new ProviderError(`Model or endpoint not found. ${detail}`, { status: res.status });
  }
  if (res.status === 429) {
    throw new ProviderError(`Rate limited. ${detail}`, { status: 429, retryable: true, rateLimited: true });
  }
  if (res.status >= 500) {
    throw new ProviderError(`Upstream error ${res.status}. ${detail}`, { status: res.status, retryable: true });
  }
  throw new ProviderError(detail || `Request failed (${res.status})`, { status: res.status });
}

/** Split streaming bytes into SSE events and invoke onEvent with `data:` payloads. */
export async function readSSE(
  res: Response,
  onEvent: (data: string) => void,
  signal?: AbortSignal
): Promise<void> {
  if (!res.body) throw new ProviderError("Response has no body to stream");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        for (const line of part.split("\n")) {
          if (line.startsWith("data:")) {
            const data = line.slice(5).trim();
            if (data && data !== "[DONE]") onEvent(data);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
