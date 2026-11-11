import type { Scene, Storyboard } from "./schema";
import {
  runCaptioner,
  runIllustrator,
  runNarrator,
  runPlanner,
  runWriter,
  type RunContext,
} from "./runner";

/**
 * Full pipeline: Planner → Writer → Illustrator → Captioner → Narrator.
 * Returns the final storyboard (or null if planning failed / cancelled).
 */
export async function runFullPipeline(ctx: RunContext): Promise<Storyboard | null> {
  let current: Storyboard | null = null;

  const tracked: RunContext = {
    ...ctx,
    onStoryboard: (sb) => {
      current = sb;
      ctx.onStoryboard(sb);
    },
    onSceneText: (index, patch) => {
      if (current) {
        current = {
          ...current,
          scenes: current.scenes.map((s) => (s.index === index ? { ...s, ...patch } : s)),
        };
      }
      ctx.onSceneText(index, patch);
    },
  };

  const planned = await runPlanner(tracked);
  if (!planned) return null;
  current = planned;

  const written = await runWriter(tracked, planned);
  current = written;

  await runIllustrator(tracked, written);

  const captioned = await runCaptioner(tracked, written);
  current = captioned;

  await runNarrator(tracked, captioned);

  return current;
}

/** Regenerate only one scene's image (or narration audio). */
export async function regenerateScene(
  ctx: RunContext,
  storyboard: Storyboard,
  sceneIndex: number,
  what: "image" | "audio" | "all"
): Promise<void> {
  const scene = storyboard.scenes.find((s) => s.index === sceneIndex);
  if (!scene) return;
  const { illustrateScene, narrateScene } = await import("./runner");
  if (what === "image" || what === "all") await illustrateScene(ctx, scene);
  if (what === "audio" || what === "all") await narrateScene(ctx, scene);
}

export type { Scene, Storyboard };
