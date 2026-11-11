export type Capability = "text" | "image" | "video" | "audio";

export const CAPABILITIES: Capability[] = ["text", "image", "video", "audio"];

export interface ModelInfo {
  id: string;
  name: string;
  capabilities: Capability[];
  contextWindow?: number;
  notes?: string;
}

export interface TextRequest {
  model: string;
  prompt: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  stream?: (delta: string) => void;
}

export interface TextResult {
  text: string;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface ImageRequest {
  model: string;
  prompt: string;
  aspectRatio?: string;
  n?: number;
  signal?: AbortSignal;
}

export interface ImageResult {
  /** base64 (no data: prefix) when possible, else a remote URL to fetch */
  b64?: string;
  url?: string;
  mimeType?: string;
  model: string;
}

export interface AudioRequest {
  model: string;
  text: string;
  voice?: string;
  format?: "mp3" | "wav" | "opus" | "flac";
  signal?: AbortSignal;
}

export interface AudioResult {
  b64?: string;
  url?: string;
  mimeType?: string;
  model: string;
}

export interface VideoRequest {
  model: string;
  prompt: string;
  durationSec?: number;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

export interface VideoResult {
  b64?: string;
  url?: string;
  mimeType?: string;
  model: string;
}

export interface ProviderMeta {
  id: string;
  name: string;
  tagline: string;
  keyUrl: string;
  keyHint: string;
  capabilities: Capability[];
  /** optional regex the key must match before we hit the network */
  keyPattern?: RegExp;
  docsUrl?: string;
}

export interface ProviderAdapter extends ProviderMeta {
  validate(apiKey: string, signal?: AbortSignal): Promise<{ ok: boolean; message?: string }>;
  listModels(apiKey: string, signal?: AbortSignal): Promise<ModelInfo[]>;
  text?(apiKey: string, req: TextRequest): Promise<TextResult>;
  image?(apiKey: string, req: ImageRequest): Promise<ImageResult>;
  audio?(apiKey: string, req: AudioRequest): Promise<AudioResult>;
  video?(apiKey: string, req: VideoRequest): Promise<VideoResult>;
}

export class ProviderError extends Error {
  readonly status?: number;
  readonly retryable: boolean;
  readonly rateLimited: boolean;

  constructor(
    message: string,
    opts: { status?: number; retryable?: boolean; rateLimited?: boolean } = {}
  ) {
    super(message);
    this.name = "ProviderError";
    this.status = opts.status;
    this.retryable = opts.retryable ?? false;
    this.rateLimited = opts.rateLimited ?? false;
  }
}
