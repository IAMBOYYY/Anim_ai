import JSZip from "jszip";
import type { ProjectRecord } from "@/lib/storage/projects";
import { buildExportProject, buildProjectHtml } from "./project";
import { slugify } from "@/lib/utils";

function textFileFor(name: string): string {
  return name.replace(/[^\w.-]+/g, "_");
}

export async function buildZipBlob(project: ProjectRecord): Promise<Blob> {
  const zip = new JSZip();
  const data = await buildExportProject(project, { inline: false });

  const root = zip.folder(slugify(project.title)) ?? zip;

  // images
  const images = root.folder("images");
  for (const scene of data.scenes) {
    if (!scene.imageFile) continue;
    const blob = project.assets[String(scene.index)]?.image;
    if (blob) images?.file(scene.imageFile.split("/").pop()!, blob);
  }

  // text
  const text = root.folder("text");
  text?.file(
    "storyboard.md",
    [
      `# ${data.meta.title}`,
      "",
      data.synopsis,
      "",
      ...data.scenes.map(
        (s) =>
          `## Scene ${s.index}: ${s.title}\n\n**Narration:** ${s.narration}\n\n**Caption:** ${s.caption}\n\n**Duration:** ${s.durationSec}s\n`
      ),
    ].join("\n")
  );
  for (const scene of data.scenes) {
    text?.file(`scene-${String(scene.index).padStart(2, "0")}.txt`, `${scene.title}\n\n${scene.narration}`);
  }

  // captions
  const captions = root.folder("captions");
  captions?.file("captions.srt", data.captions.srt);
  captions?.file("captions.vtt", data.captions.vtt);

  // audio
  const audio = root.folder("audio");
  for (const scene of data.scenes) {
    if (!scene.audioFile) continue;
    const blob = project.assets[String(scene.index)]?.audio;
    if (blob) audio?.file(scene.audioFile.split("/").pop()!, blob);
  }

  // prompts
  const prompts = root.folder("prompts");
  prompts?.file(
    "prompts.txt",
    data.scenes.map((s) => `[Scene ${s.index}] ${s.title}\n${s.imagePrompt}\n`).join("\n")
  );
  prompts?.file(
    "brief.txt",
    `Style: ${data.meta.style}\nPrompt: ${data.meta.prompt}\n\n${data.synopsis}\n`
  );

  // logs
  const logs = root.folder("logs");
  logs?.file(
    "agent-log.json",
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        project: data.meta.title,
        entries: data.logs.map((l) => ({
          agent: l.agent,
          provider: l.providerId,
          model: l.model,
          task: l.task,
          status: l.status,
          durationMs: l.durationMs,
          retries: l.retries,
          error: l.error,
          scene: l.sceneIndex,
          costHint: l.costHint,
        })),
      },
      null,
      2
    )
  );
  logs?.file(
    "agent-log.md",
    [
      `# Agent log — ${data.meta.title}`,
      "",
      "| Agent | Provider | Model | Task | Status | Duration |",
      "|---|---|---|---|---|---|",
      ...data.logs.map(
        (l) =>
          `| ${l.agent} | ${l.providerId} | ${l.model} | ${textFileFor(l.task).slice(0, 40)} | ${l.status} | ${l.durationMs ? `${Math.round(l.durationMs / 100) / 10}s` : "—"} |`
      ),
    ].join("\n")
  );

  // project files
  root.file("project.json", JSON.stringify(data, null, 2));
  root.file("project.html", await buildProjectHtml(project));

  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function downloadProjectZip(project: ProjectRecord): Promise<void> {
  const blob = await buildZipBlob(project);
  downloadBlob(blob, `${slugify(project.title)}-${project.id.slice(0, 8)}.zip`);
}

export async function downloadProjectHtml(project: ProjectRecord): Promise<void> {
  const html = await buildProjectHtml(project);
  downloadBlob(new Blob([html], { type: "text/html" }), `${slugify(project.title)}.html`);
}
