import { z } from "zod";

export const SceneSchema = z.object({
  index: z.number().int().min(1).max(64),
  title: z.string().min(1).max(120),
  narration: z.string().min(1).max(4000),
  caption: z.string().max(400).default(""),
  imagePrompt: z.string().min(3).max(2000),
  durationSec: z.number().min(1).max(60).default(5),
});

export const StoryboardSchema = z.object({
  title: z.string().min(1).max(200),
  synopsis: z.string().min(1).max(2000),
  style: z.string().max(120).optional(),
  scenes: z.array(SceneSchema).min(1).max(32),
});

export type Scene = z.infer<typeof SceneSchema>;
export type Storyboard = z.infer<typeof StoryboardSchema>;

export const PLAN_SYSTEM_PROMPT = `You are the Planner agent in a multi-AI animation studio.
Given a user's creative prompt and a visual style, produce a production-ready storyboard as STRICT JSON with this exact shape:
{
  "title": "string",
  "synopsis": "1-3 sentence summary",
  "style": "the visual style used",
  "scenes": [
    {
      "index": 1,
      "title": "short scene title",
      "narration": "2-4 sentences of voice-over narration for this scene",
      "caption": "short on-screen caption (<= 90 chars)",
      "imagePrompt": "detailed image generation prompt: subject, action, setting, lighting, camera, mood. No text overlays.",
      "durationSec": 5
    }
  ]
}
Rules:
- Between 3 and ${"8"} scenes unless the user asks otherwise.
- imagePrompt must be self-contained (a generator sees only that string).
- Narration should flow as one continuous story across scenes.
- Output ONLY the JSON object. No markdown, no commentary.`;

export function buildPlanUserPrompt(opts: {
  prompt: string;
  style: string;
  sceneCount: number;
}): string {
  return `Creative brief: ${opts.prompt}\nVisual style: ${opts.style}\nTarget scene count: ~${opts.sceneCount}`;
}

/** Validate and normalize a planner response. */
export function parseStoryboard(raw: string): Storyboard {
  let parsed: unknown;
  try {
    // strip fences if present
    const cleaned = raw.replace(/```(?:json)?/gi, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("Planner did not return JSON");
    parsed = JSON.parse(raw.slice(start, end + 1));
  }

  const result = StoryboardSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`Storyboard validation failed: ${issue ? `${issue.path.join(".")} — ${issue.message}` : "unknown"}`);
  }

  // reindex scenes sequentially
  const scenes = result.data.scenes.map((s, i) => ({ ...s, index: i + 1 }));
  return { ...result.data, scenes };
}

export function buildSrt(scenes: Scene[]): string {
  let cursor = 0;
  const lines: string[] = [];
  scenes.forEach((scene, i) => {
    const start = cursor;
    const end = cursor + Math.max(1, scene.durationSec);
    cursor = end;
    lines.push(String(i + 1));
    lines.push(`${fmtTime(start)} --> ${fmtTime(end)}`);
    lines.push(scene.caption || scene.narration.slice(0, 80));
    lines.push("");
  });
  return lines.join("\n");
}

export function buildVtt(scenes: Scene[]): string {
  let cursor = 0;
  const lines: string[] = ["WEBVTT", ""];
  for (const scene of scenes) {
    const start = cursor;
    const end = cursor + Math.max(1, scene.durationSec);
    cursor = end;
    lines.push(`${fmtTime(start, ".")} --> ${fmtTime(end, ".")}`);
    lines.push(scene.caption || scene.narration.slice(0, 80));
    lines.push("");
  }
  return lines.join("\n");
}

function fmtTime(totalSec: number, sep = ","): string {
  const ms = Math.round(totalSec * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const rest = ms % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${String(rest).padStart(3, "0")}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
