import type { Capability, ModelInfo } from "./types";

const TEXT_HINTS = [
  "chat", "instruct", "llama", "gpt", "claude", "gemini", "mistral", "qwen", "deepseek",
  "phi", "gemma", "command", "sonar", "nemotron", "yi", "starcoder", "codellama", "whisper-tt",
];

const IMAGE_GEN_HINTS = [
  "image", "dall-e", "dalle", "flux", "sdxl", "stable-diffusion", "stablediffusion", "sdx",
  "imagen", "mj", "midjourney", "playground", "kandinsky", "realvis", "juggernaut", "turbo",
  "pixart", "kolors", "hidream", "recraft", "ideogram", "svd", "text-to-image", "txt2img",
];

const VIDEO_HINTS = [
  "video", "sora", "kling", "runway", "luma", "hailuo", "minimax", "wan", "mochi", "cogvideox",
  "svd", "i2v", "t2v", "motion", "veo",
];

const AUDIO_HINTS = [
  "audio", "tts", "speech", "voice", "whisper", "music", "sound", "eleven", "playai", "sonic",
  "tortoise", "bark", "riffusion", "stable-audio", "melo", "kokoro", "vits",
];

function has(id: string, hints: string[]): boolean {
  const s = id.toLowerCase();
  return hints.some((h) => s.includes(h));
}

/**
 * Best-effort capability classification from model ids.
 * Adapters can override by returning explicit capabilities.
 */
export function classifyModel(id: string, extra: Capability[] = []): Capability[] {
  const caps = new Set<Capability>(extra);
  if (has(id, IMAGE_GEN_HINTS)) caps.add("image");
  if (has(id, VIDEO_HINTS)) caps.add("video");
  if (has(id, AUDIO_HINTS)) caps.add("audio");

  // Vision-input models are still text chat models for our purposes.
  const isMedia = caps.has("image") || caps.has("video") || caps.has("audio");
  if (!isMedia || has(id, TEXT_HINTS)) {
    if (!has(id, VIDEO_HINTS) || has(id, TEXT_HINTS)) caps.add("text");
  }
  if (caps.size === 0) caps.add("text");
  return [...caps];
}

export function groupByCapability(models: ModelInfo[]): Record<Capability, ModelInfo[]> {
  const groups: Record<Capability, ModelInfo[]> = { text: [], image: [], video: [], audio: [] };
  for (const m of models) {
    for (const c of m.capabilities) groups[c].push(m);
  }
  return groups;
}

/** Rough cost hints (USD) — approximate, shown as estimates in the UI. */
export function estimateCost(providerId: string, model: string, capability: Capability): string {
  const id = `${providerId}/${model}`.toLowerCase();
  const free =
    id.includes("free") || ["groq", "openrouter", "google"].includes(providerId);
  if (capability === "image") {
    if (free) return "~free tier / ≤$0.01 per image";
    return "~$0.01–0.08 per image (estimate)";
  }
  if (capability === "audio") {
    if (free) return "~free tier / ≤$0.01 per 1k chars";
    return "~$0.01–0.05 per 1k chars (estimate)";
  }
  if (capability === "video") return "~$0.05–0.50 per clip (estimate)";
  if (free) return "often free or ≤$0.10 / 1M tokens";
  return "~$0.10–3.00 / 1M tokens (estimate)";
}
