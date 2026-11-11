import { anthropic } from "./anthropic";
import { elevenlabs } from "./elevenlabs";
import { fal } from "./fal";
import { google } from "./google";
import { groq } from "./groq";
import { huggingface } from "./huggingface";
import { mistral } from "./mistral";
import { nvidia } from "./nvidia";
import { openai } from "./openai";
import { openrouter } from "./openrouter";
import { replicate } from "./replicate";
import { stability } from "./stability";
import { together } from "./together";
import { customAdapter } from "./custom";
import type { ProviderAdapter } from "./types";

/** Ordered registry — adding a provider = one file + one line here. */
export const PROVIDERS: ProviderAdapter[] = [
  google,
  groq,
  openrouter,
  nvidia,
  together,
  huggingface,
  mistral,
  openai,
  anthropic,
  replicate,
  fal,
  stability,
  elevenlabs,
  customAdapter(""),
];

const map = new Map(PROVIDERS.map((p) => [p.id, p]));

export function getAdapter(providerId: string, opts?: { customBaseUrl?: string }): ProviderAdapter | undefined {
  if (providerId === "custom") return customAdapter(opts?.customBaseUrl ?? "");
  return map.get(providerId);
}

export function providerById(providerId: string): ProviderAdapter | undefined {
  return map.get(providerId);
}

export * from "./types";
