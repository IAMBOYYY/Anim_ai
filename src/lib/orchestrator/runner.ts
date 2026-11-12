import { estimateCost } from "@/lib/providers/capabilities";
import { getAdapter } from "@/lib/providers/registry";
import { ProviderError, type Capability } from "@/lib/providers/types";
import type { AppSettings } from "@/lib/storage/settings";
import { providerSettings, styleSuffix, type StyleId } from "@/lib/storage/settings";
import { isAbortError } from "@/lib/utils";
import { parseStoryboard, PLAN_SYSTEM_PROMPT, buildPlanUserPrompt, type Scene, type Storyboard } from "./schema";

export type AgentId = "planner" | "writer" | "illustrator" | "captioner" | "narrator";
export type TaskStatus = "queued" | "working" | "done" | "failed" | "skipped";

export interface AgentTaskState {
  id: string;
  agent: AgentId;
  label: string;
  sceneIndex?: number;
  providerId: string;
  model: string;
  task: string;
  status: TaskStatus;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  retries?: number;
  error?: string;
  progress?: string;
  costHint?: string;
  skipReason?: string;
}

export interface RunContext {
  settings: AppSettings;
  keys: Record<string, string>;
  prompt: string;
  style: StyleId;
  signal: AbortSignal;
  onTask: (task: AgentTaskState) => void;
  onStoryboard: (sb: Storyboard) => void;
  onSceneText: (index: number, patch: Partial<Scene>) => void;
  onSceneAsset: (index: number, kind: "image" | "audio", blob: Blob, mime: string) => void;
  onLog: (task: AgentTaskState) => void;
  onNotice: (message: string) => void;
}

export interface CapabilityRoute {
  providerId: string;
  model: string;
  key: string;
}

export function findRoute(
  ctx: RunContext,
  capability: Capability
): { route: CapabilityRoute | null; reason?: string } {
  const order = Object.keys(ctx.settings.providers);

  // 1) explicit default chosen by the user in Settings → Default routing
  const explicit = ctx.settings.defaults?.[capability];
  if (explicit) {
    const ps = providerSettings(ctx.settings, explicit.providerId);
    const adapter = getAdapter(explicit.providerId, { customBaseUrl: ps.customBaseUrl });
    const key = ctx.keys[explicit.providerId];
    if (ps.enabled && adapter?.capabilities.includes(capability) && ps.models[capability] === explicit.model && key) {
      return { route: { providerId: explicit.providerId, model: explicit.model, key } };
    }
  }

  // 2) first enabled provider with a model + key for this capability
  let keylessReason: string | null = null;
  for (const providerId of order) {
    const ps = providerSettings(ctx.settings, providerId);
    if (!ps.enabled) continue;
    const adapter = getAdapter(providerId, { customBaseUrl: ps.customBaseUrl });
    if (!adapter || !adapter.capabilities.includes(capability)) continue;
    const model = ps.models[capability];
    if (!model) continue;
    const key = ctx.keys[providerId];
    if (!key) {
      keylessReason ??= `${adapter.name} is selected for ${capability} but its API key is missing`;
      continue;
    }
    return { route: { providerId, model, key } };
  }
  return {
    route: null,
    reason: keylessReason ?? `No enabled provider with a ${capability} model and key`,
  };
}

function makeTask(
  agent: AgentId,
  label: string,
  route: { providerId: string; model: string } | null,
  task: string,
  sceneIndex?: number
): AgentTaskState {
  return {
    id: `${agent}:${sceneIndex ?? "global"}`,
    agent,
    label,
    sceneIndex,
    providerId: route?.providerId ?? "—",
    model: route?.model ?? "—",
    task,
    status: route ? "queued" : "skipped",
    costHint: route ? estimateCost(route.providerId, route.model, agent === "illustrator" ? "image" : agent === "narrator" ? "audio" : "text") : undefined,
  };
}

async function executeTask<T>(
  ctx: RunContext,
  task: AgentTaskState,
  routeInfo: { route: CapabilityRoute | null; reason?: string },
  work: (route: CapabilityRoute, task: AgentTaskState) => Promise<T>
): Promise<T | null> {
  if (task.status === "skipped") {
    ctx.onTask(task);
    ctx.onLog(task);
    ctx.onNotice(`Skipped ${task.label}: ${task.skipReason ?? "no route"}`);
    return null;
  }

  if (!routeInfo.route) {
    task.status = "skipped";
    task.skipReason = routeInfo.reason;
    task.endedAt = Date.now();
    ctx.onTask(task);
    ctx.onLog(task);
    ctx.onNotice(`Skipped ${task.label}: ${routeInfo.reason}`);
    return null;
  }
  const route = routeInfo.route;
  task.providerId = route.providerId;
  task.model = route.model;
  task.costHint = estimateCost(route.providerId, route.model, task.agent === "illustrator" ? "image" : task.agent === "narrator" ? "audio" : "text");

  const maxRetries = ctx.settings.maxRetries ?? 2;
  let attempt = 0;
  let lastErr: unknown;

  while (attempt <= maxRetries) {
    if (ctx.signal.aborted) throw new DOMException("Aborted", "AbortError");
    task.status = "working";
    task.retries = attempt;
    task.startedAt = task.startedAt ?? Date.now();
    task.error = undefined;
    ctx.onTask(task);

    try {
      const result = await work(route, task);
      task.status = "done";
      task.endedAt = Date.now();
      task.durationMs = task.endedAt - (task.startedAt ?? task.endedAt);
      ctx.onTask(task);
      ctx.onLog({ ...task });
      return result;
    } catch (err) {
      lastErr = err;
      if (isAbortError(err) || ctx.signal.aborted) throw err;
      const retryable =
        err instanceof ProviderError ? err.retryable : attempt < maxRetries; // generic errors: still retry a couple times
      task.error = err instanceof Error ? err.message : String(err);
      if (!retryable || attempt === maxRetries) break;
      attempt += 1;
      const delay = Math.min(8000, 700 * 2 ** (attempt - 1)) * (0.7 + Math.random() * 0.5);
      task.progress = err instanceof ProviderError && err.rateLimited
        ? `Rate limited — retrying in ${(delay / 1000).toFixed(1)}s`
        : `Retrying in ${(delay / 1000).toFixed(1)}s (${attempt}/${maxRetries})`;
      ctx.onTask(task);
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, Math.round(delay));
        ctx.signal.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
      });
    }
  }

  task.status = "failed";
  task.endedAt = Date.now();
  task.durationMs = task.endedAt - (task.startedAt ?? task.endedAt);
  task.error = lastErr instanceof Error ? lastErr.message : String(lastErr);
  task.progress = undefined;
  ctx.onTask(task);
  ctx.onLog({ ...task });
  ctx.onNotice(`${task.label} failed: ${task.error}`);
  return null;
}

/* ---------------- Planner ---------------- */

export async function runPlanner(ctx: RunContext): Promise<Storyboard | null> {
  const routeInfo = findRoute(ctx, "text");
  const task = makeTask("planner", "Planner", routeInfo.route, "Create storyboard plan");
  if (!routeInfo.route) {
    task.status = "skipped";
    task.skipReason = routeInfo.reason;
    ctx.onTask(task);
    ctx.onLog(task);
    return null;
  }

  return executeTask(ctx, task, routeInfo, async (route) => {
    const adapter = getAdapter(route.providerId, {
      customBaseUrl: providerSettings(ctx.settings, route.providerId).customBaseUrl,
    });
    if (!adapter?.text) throw new Error(`${adapter?.name ?? route.providerId} has no text capability`);

    let raw = "";
    const result = await adapter.text(route.key, {
      model: route.model,
      system: PLAN_SYSTEM_PROMPT,
      prompt: buildPlanUserPrompt({
        prompt: ctx.prompt,
        style: `${styleSuffix(ctx.style)}`,
        sceneCount: ctx.settings.sceneCount,
      }),
      temperature: 0.7,
      maxTokens: 6000,
      signal: ctx.signal,
      stream: (delta) => {
        raw += delta;
        task.progress = raw.length > 240 ? `…${raw.slice(-240).replace(/\s+/g, " ")}` : raw.replace(/\s+/g, " ");
        ctx.onTask(task);
      },
    });

    task.progress = undefined;
    const storyboard = parseStoryboard(result.text || raw);
    ctx.onStoryboard(storyboard);
    return storyboard;
  });
}

/* ---------------- Writer ---------------- */

export async function runWriter(ctx: RunContext, storyboard: Storyboard): Promise<Storyboard | null> {
  const routeInfo = findRoute(ctx, "text");
  const task = makeTask("writer", "Writer", routeInfo.route, "Polish narration & captions");
  if (!routeInfo.route) {
    task.status = "skipped";
    task.skipReason = routeInfo.reason;
    ctx.onTask(task);
    ctx.onLog(task);
    return storyboard; // keep planner output
  }

  const updated = await executeTask(ctx, task, routeInfo, async (route) => {
    const adapter = getAdapter(route.providerId, {
      customBaseUrl: providerSettings(ctx.settings, route.providerId).customBaseUrl,
    });
    if (!adapter?.text) throw new Error("No text adapter");

    const sceneLines = storyboard.scenes
      .map((s) => `SCENE ${s.index} — ${s.title}\nNARRATION: ${s.narration}\nCAPTION: ${s.caption}`)
      .join("\n\n");

    const prompt = `You are the Writer agent. Improve the narration below for spoken voice-over: vivid, natural, correct pacing. Keep scene count and order identical. Keep each caption ≤ 90 characters.
Return ONLY JSON: {"scenes":[{"index":1,"narration":"…","caption":"…"}]}

${sceneLines}`;

    const result = await adapter.text(route.key, {
      model: route.model,
      prompt,
      temperature: 0.8,
      maxTokens: 6000,
      signal: ctx.signal,
      stream: (delta) => {
        task.progress = delta.slice(-200);
        ctx.onTask(task);
      },
    });

    let parsed: { scenes?: { index: number; narration?: string; caption?: string }[] };
    try {
      const cleaned = result.text.replace(/```(?:json)?/gi, "").trim();
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      parsed = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return storyboard; // graceful: keep planner text
    }

    const scenes = storyboard.scenes.map((scene) => {
      const hit = parsed.scenes?.find((s) => s.index === scene.index);
      if (!hit) return scene;
      const next: Scene = {
        ...scene,
        narration: hit.narration?.trim() || scene.narration,
        caption: (hit.caption ?? scene.caption).slice(0, 90),
      };
      ctx.onSceneText(scene.index, { narration: next.narration, caption: next.caption });
      return next;
    });

    task.progress = undefined;
    return { ...storyboard, scenes };
  });

  return updated ?? storyboard;
}

/* ---------------- Illustrator ---------------- */

export async function runIllustrator(ctx: RunContext, storyboard: Storyboard): Promise<void> {
  const routeInfo = findRoute(ctx, "image");
  const limit = 2;
  const queue = [...storyboard.scenes];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const scene = queue.shift();
      if (!scene || ctx.signal.aborted) break;
      await illustrateScene(ctx, scene, routeInfo.route);
    }
  });
  await Promise.all(workers);
}

export async function illustrateScene(
  ctx: RunContext,
  scene: Scene,
  knownRoute?: CapabilityRoute | null
): Promise<Blob | null> {
  const routeInfo = knownRoute !== undefined ? { route: knownRoute } : findRoute(ctx, "image");
  const task = makeTask("illustrator", "Illustrator", routeInfo.route, `Render scene ${scene.index}: ${scene.title}`, scene.index);
  if (!routeInfo.route) {
    task.skipReason = routeInfo.reason;
  }

  const fullPrompt = `${scene.imagePrompt}. Style: ${styleSuffix(ctx.style)}. No text, no watermark, no captions.`;

  const result = await executeTask(ctx, task, routeInfo, async (route) => {
    const adapter = getAdapter(route.providerId, {
      customBaseUrl: providerSettings(ctx.settings, route.providerId).customBaseUrl,
    });
    if (!adapter?.image) throw new Error(`${adapter?.name ?? route.providerId} has no image capability`);
    task.progress = "Generating…";
    ctx.onTask(task);
    const out = await adapter.image(route.key, {
      model: route.model,
      prompt: fullPrompt,
      aspectRatio: "2:3",
      signal: ctx.signal,
    });
    task.progress = "Downloading…";
    ctx.onTask(task);
    return out;
  });

  if (!result) return null;

  try {
    const blob = await mediaToBlob(result.b64, result.url, result.mimeType ?? "image/png", ctx.signal);
    ctx.onSceneAsset(scene.index, "image", blob, blob.type || result.mimeType || "image/png");
    return blob;
  } catch (err) {
    task.status = "failed";
    task.error = err instanceof Error ? err.message : String(err);
    task.endedAt = Date.now();
    ctx.onTask(task);
    ctx.onLog({ ...task });
    return null;
  }
}

/* ---------------- Captioner ---------------- */

export async function runCaptioner(ctx: RunContext, storyboard: Storyboard): Promise<Storyboard> {
  const routeInfo = findRoute(ctx, "text");
  const task = makeTask("captioner", "Captioner", routeInfo.route, "Write on-screen captions");

  const updated = await executeTask(ctx, task, routeInfo, async (route) => {
    const adapter = getAdapter(route.providerId, {
      customBaseUrl: providerSettings(ctx.settings, route.providerId).customBaseUrl,
    });
    if (!adapter?.text) throw new Error("No text adapter");

    const prompt = `You are the Captioner agent. For each scene write a punchy on-screen caption (≤ 80 chars, no quotes).
Return ONLY JSON: {"scenes":[{"index":1,"caption":"…"}]}

${storyboard.scenes.map((s) => `SCENE ${s.index}: ${s.narration.slice(0, 200)}`).join("\n")}`;

    const result = await adapter.text(route.key, {
      model: route.model,
      prompt,
      temperature: 0.6,
      maxTokens: 3000,
      signal: ctx.signal,
    });

    try {
      const cleaned = result.text.replace(/```(?:json)?/gi, "").trim();
      const parsed = JSON.parse(cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1)) as {
        scenes?: { index: number; caption?: string }[];
      };
      const scenes = storyboard.scenes.map((scene) => {
        const hit = parsed.scenes?.find((s) => s.index === scene.index);
        if (!hit?.caption) return scene;
        const next = { ...scene, caption: hit.caption.slice(0, 90) };
        ctx.onSceneText(scene.index, { caption: next.caption });
        return next;
      });
      return { ...storyboard, scenes };
    } catch {
      // graceful fallback: derive captions from narration
      return fallbackCaptions(ctx, storyboard);
    }
  });

  return updated ?? fallbackCaptions(ctx, storyboard);
}

function fallbackCaptions(ctx: RunContext, storyboard: Storyboard): Storyboard {
  const scenes = storyboard.scenes.map((scene) => {
    const caption = scene.caption || firstSentence(scene.narration).slice(0, 90);
    if (caption !== scene.caption) ctx.onSceneText(scene.index, { caption });
    return { ...scene, caption };
  });
  return { ...storyboard, scenes };
}

function firstSentence(text: string): string {
  const m = text.match(/^([^.!?]{8,}[.!?])/);
  return m ? m[1].trim() : text.trim().split(/\s+/).slice(0, 14).join(" ");
}

/* ---------------- Narrator ---------------- */

export async function runNarrator(ctx: RunContext, storyboard: Storyboard): Promise<void> {
  const routeInfo = findRoute(ctx, "audio");
  for (const scene of storyboard.scenes) {
    if (ctx.signal.aborted) throw new DOMException("Aborted", "AbortError");
    await narrateScene(ctx, scene, routeInfo.route);
  }
}

export async function narrateScene(
  ctx: RunContext,
  scene: Scene,
  knownRoute?: CapabilityRoute | null
): Promise<Blob | null> {
  const routeInfo = knownRoute !== undefined ? { route: knownRoute } : findRoute(ctx, "audio");
  const task = makeTask("narrator", "Narrator", routeInfo.route, `Narrate scene ${scene.index}`, scene.index);
  if (!routeInfo.route) task.skipReason = routeInfo.reason;

  const result = await executeTask(ctx, task, routeInfo, async (route) => {
    const adapter = getAdapter(route.providerId, {
      customBaseUrl: providerSettings(ctx.settings, route.providerId).customBaseUrl,
    });
    if (!adapter?.audio) throw new Error(`${adapter?.name ?? route.providerId} has no audio capability`);
    task.progress = "Synthesizing…";
    ctx.onTask(task);
    return adapter.audio(route.key, {
      model: route.model,
      text: scene.narration,
      voice: process.env.NEXT_PUBLIC_DEFAULT_VOICE,
      signal: ctx.signal,
    });
  });

  if (!result) return null;

  try {
    const blob = await mediaToBlob(result.b64, result.url, result.mimeType ?? "audio/mpeg", ctx.signal);
    ctx.onSceneAsset(scene.index, "audio", blob, blob.type || result.mimeType || "audio/mpeg");
    return blob;
  } catch (err) {
    task.status = "failed";
    task.error = err instanceof Error ? err.message : String(err);
    task.endedAt = Date.now();
    ctx.onTask(task);
    ctx.onLog({ ...task });
    return null;
  }
}

/* ---------------- media helpers ---------------- */

export async function mediaToBlob(
  b64: string | undefined,
  url: string | undefined,
  fallbackMime: string,
  signal?: AbortSignal
): Promise<Blob> {
  if (b64) {
    const clean = b64.replace(/^data:[^;]+;base64,/, "");
    const bin = atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: fallbackMime });
  }
  if (!url) throw new Error("No media returned by provider");

  // fetch through the stateless proxy to avoid CORS
  const res = await fetch("/api/proxy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, method: "GET" }),
    signal,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to download media (${res.status})`);
  const type = res.headers.get("content-type") || fallbackMime;
  return res.blob();
}
