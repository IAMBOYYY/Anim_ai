import { z } from "zod";
import type { Capability } from "@/lib/providers/types";
import { idbGet, idbGetAll, idbPut } from "./db";

export const StyleSchema = z.enum([
  "cinematic",
  "anime",
  "3d",
  "watercolor",
  "pixel",
  "comic",
  "noir",
  "storybook",
]);
export type StyleId = z.infer<typeof StyleSchema>;

export const PROMPT_STYLES: { id: StyleId; label: string; suffix: string; emoji: string }[] = [
  {
    id: "cinematic",
    label: "Cinematic",
    emoji: "🎬",
    suffix:
      "cinematic still, dramatic lighting, shallow depth of field, 35mm film grain, anamorphic lens flare, rich color grading, epic composition",
  },
  {
    id: "anime",
    label: "Anime",
    emoji: "🌸",
    suffix:
      "anime key visual, cel shading, vibrant colors, detailed line art, expressive characters, studio quality, dynamic angle",
  },
  {
    id: "3d",
    label: "3D Render",
    emoji: "🧊",
    suffix:
      "3D render, octane, subsurface scattering, soft global illumination, physically based materials, high detail, ray traced",
  },
  {
    id: "watercolor",
    label: "Watercolor",
    emoji: "🎨",
    suffix:
      "watercolor painting, soft washes, visible paper texture, gentle color bleeds, hand-painted illustration",
  },
  {
    id: "pixel",
    label: "Pixel Art",
    emoji: "👾",
    suffix: "pixel art, 16-bit retro game style, limited palette, crisp pixels, charming detail",
  },
  {
    id: "comic",
    label: "Comic",
    emoji: "💥",
    suffix: "comic book panel, bold ink outlines, halftone dots, dynamic action composition, vivid flat colors",
  },
  {
    id: "noir",
    label: "Film Noir",
    emoji: "🕵️",
    suffix: "film noir, high contrast black and white, venetian blind shadows, moody atmosphere, grainy monochrome",
  },
  {
    id: "storybook",
    label: "Storybook",
    emoji: "📖",
    suffix: "children's storybook illustration, gouache, whimsical, warm palette, hand-drawn charm",
  },
];

export function styleSuffix(id: StyleId): string {
  return PROMPT_STYLES.find((s) => s.id === id)?.suffix ?? "";
}

export function styleLabel(id: StyleId): string {
  return PROMPT_STYLES.find((s) => s.id === id)?.label ?? id;
}

export const ProviderSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  models: z.record(z.string(), z.string()).default({}),
  customBaseUrl: z.string().optional(),
});
export type ProviderSettings = z.infer<typeof ProviderSettingsSchema>;

export const AppSettingsSchema = z.object({
  id: z.literal("app"),
  providers: z.record(z.string(), ProviderSettingsSchema).default({}),
  style: StyleSchema.default("cinematic"),
  sceneCount: z.number().int().min(2).max(16).default(6),
  autoDownload: z.boolean().default(false),
  maxRetries: z.number().int().min(0).max(5).default(2),
  temperature: z.number().min(0).max(2).default(0.85),
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

export const DEFAULT_SETTINGS: AppSettings = {
  id: "app",
  providers: {},
  style: "cinematic",
  sceneCount: 6,
  autoDownload: false,
  maxRetries: 2,
  temperature: 0.85,
};

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await idbGet<AppSettings>("settings", "app");
    if (!raw) return { ...DEFAULT_SETTINGS };
    return AppSettingsSchema.parse({ ...DEFAULT_SETTINGS, ...raw });
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await idbPut("settings", AppSettingsSchema.parse(settings));
}

export function providerSettings(settings: AppSettings, providerId: string): ProviderSettings {
  return settings.providers[providerId] ?? { enabled: true, models: {} };
}

export interface CapabilityRoute {
  providerId: string;
  model: string;
}

/** Resolve the best available route for a capability (explicit default → any enabled provider with a model). */
export function resolveRoute(
  settings: AppSettings,
  capability: Capability,
  order: string[]
): CapabilityRoute | null {
  for (const providerId of order) {
    const ps = settings.providers[providerId];
    if (!ps || !ps.enabled) continue;
    const model = ps.models[capability];
    if (model) return { providerId, model };
  }
  return null;
}

export async function listSettings(): Promise<AppSettings[]> {
  return idbGetAll<AppSettings>("settings");
}
