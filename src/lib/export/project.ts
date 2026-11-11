import type { AgentLogEntry, ProjectRecord } from "@/lib/storage/projects";
import { styleLabel } from "@/lib/storage/settings";
import { buildSrt, buildVtt } from "@/lib/orchestrator/schema";

export interface ExportScene {
  index: number;
  title: string;
  narration: string;
  caption: string;
  imagePrompt: string;
  durationSec: number;
  imageFile?: string;
  audioFile?: string;
  imageDataUrl?: string;
  audioDataUrl?: string;
  imageMime?: string;
  audioMime?: string;
}

export interface ExportProject {
  meta: {
    id: string;
    title: string;
    createdAt: number;
    generator: "AnimAI Studio";
    version: 1;
    style: string;
    prompt: string;
  };
  synopsis: string;
  scenes: ExportScene[];
  captions: { srt: string; vtt: string };
  logs: AgentLogEntry[];
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });
}

function extFor(mime: string | undefined, kind: "image" | "audio"): string {
  const m = (mime || "").toLowerCase();
  if (kind === "image") {
    if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
    if (m.includes("webp")) return "webp";
    if (m.includes("gif")) return "gif";
    return "png";
  }
  if (m.includes("wav")) return "wav";
  if (m.includes("opus")) return "opus";
  if (m.includes("flac")) return "flac";
  if (m.includes("ogg")) return "ogg";
  return "mp3";
}

export async function buildExportProject(project: ProjectRecord, opts?: { inline?: boolean }): Promise<ExportProject> {
  const inline = opts?.inline ?? false;
  const scenes: ExportScene[] = [];

  for (const scene of project.storyboard.scenes) {
    const assets = project.assets[String(scene.index)] ?? {};
    const entry: ExportScene = {
      index: scene.index,
      title: scene.title,
      narration: scene.narration,
      caption: scene.caption,
      imagePrompt: scene.imagePrompt,
      durationSec: scene.durationSec,
      imageMime: assets.imageMime,
      audioMime: assets.audioMime,
    };

    if (assets.image) {
      const ext = extFor(assets.imageMime, "image");
      entry.imageFile = `images/scene-${String(scene.index).padStart(2, "0")}.${ext}`;
      if (inline) entry.imageDataUrl = await blobToDataUrl(assets.image);
    }
    if (assets.audio) {
      const ext = extFor(assets.audioMime, "audio");
      entry.audioFile = `audio/scene-${String(scene.index).padStart(2, "0")}.${ext}`;
      if (inline) entry.audioDataUrl = await blobToDataUrl(assets.audio);
    }
    scenes.push(entry);
  }

  return {
    meta: {
      id: project.id,
      title: project.title,
      createdAt: project.createdAt,
      generator: "AnimAI Studio",
      version: 1,
      style: styleLabel(project.style as never) || project.style,
      prompt: project.prompt,
    },
    synopsis: project.storyboard.synopsis,
    scenes,
    captions: {
      srt: project.srt || buildSrt(project.storyboard.scenes),
      vtt: project.vtt || buildVtt(project.storyboard.scenes),
    },
    logs: project.logs ?? [],
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escAttr(text: string): string {
  return escapeHtml(text).replace(/'/g, "&#39;");
}

/** Self-contained viewer: all images/audio inlined as data URLs. */
export async function buildProjectHtml(project: ProjectRecord): Promise<string> {
  const data = await buildExportProject(project, { inline: true });
  const scenesHtml = data.scenes
    .map((s) => {
      const img = s.imageDataUrl
        ? `<img class="scene-img" src="${s.imageDataUrl}" alt="${escAttr(s.title)}" loading="lazy" />`
        : `<div class="scene-img placeholder">No image</div>`;
      const audio = s.audioDataUrl
        ? `<audio controls preload="metadata" src="${s.audioDataUrl}"></audio>`
        : "";
      const caption = s.caption ? `<p class="caption">${escapeHtml(s.caption)}</p>` : "";
      return `
      <section class="scene" id="scene-${s.index}">
        <header>
          <span class="badge">${String(s.index).padStart(2, "0")}</span>
          <h2>${escapeHtml(s.title)}</h2>
          <span class="dur">${s.durationSec}s</span>
        </header>
        <div class="media">${img}${audio}</div>
        <p class="narration">${escapeHtml(s.narration)}</p>
        ${caption}
        <details><summary>Image prompt</summary><code>${escapeHtml(s.imagePrompt)}</code></details>
      </section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(data.meta.title)} — AnimAI Studio</title>
<style>
  :root { color-scheme: dark; --bg:#08090f; --fg:#eceef6; --muted:#9297ad; --card:#141623; --accent:#7c6cff; --border:rgba(255,255,255,.1); }
  * { box-sizing: border-box; }
  body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background:var(--bg); color:var(--fg); line-height:1.55; }
  .wrap { max-width: 900px; margin: 0 auto; padding: 40px 20px 80px; }
  h1 { font-size: clamp(1.6rem, 4vw, 2.4rem); margin: 0 0 6px; letter-spacing: -.02em; }
  .synopsis { color: var(--muted); margin: 0 0 8px; }
  .meta { color: var(--muted); font-size: .85rem; margin-bottom: 32px; }
  .scene { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 18px; margin-bottom: 22px; }
  .scene header { display:flex; align-items:center; gap:10px; margin-bottom:12px; }
  .scene h2 { font-size: 1.1rem; margin:0; flex:1; }
  .badge { background: var(--accent); color:#fff; border-radius: 8px; font-size:.75rem; padding:2px 8px; font-weight:700; }
  .dur { color: var(--muted); font-size:.8rem; }
  .media { display:grid; gap:12px; margin-bottom:12px; }
  .scene-img { width:100%; border-radius: 12px; display:block; background:#000; aspect-ratio: 2/3; object-fit: cover; max-height: 520px; }
  .scene-img.placeholder { display:grid; place-items:center; color:var(--muted); border:1px dashed var(--border); }
  audio { width:100%; }
  .narration { margin: 0 0 6px; }
  .caption { color: var(--accent); font-weight: 600; margin: 0 0 8px; }
  details { color: var(--muted); font-size:.85rem; }
  details code { white-space: pre-wrap; word-break: break-word; display:block; margin-top:6px; color:#c9c4ff; }
  footer { color: var(--muted); font-size:.8rem; text-align:center; margin-top:40px; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>${escapeHtml(data.meta.title)}</h1>
    <p class="synopsis">${escapeHtml(data.synopsis)}</p>
    <p class="meta">${escapeHtml(data.meta.style)} · ${data.scenes.length} scenes · ${escapeHtml(new Date(data.meta.createdAt).toLocaleString())}</p>
    ${scenesHtml}
    <footer>Generated by AnimAI Studio · prompt: “${escapeHtml(data.meta.prompt)}”</footer>
  </div>
</body>
</html>`;
}
