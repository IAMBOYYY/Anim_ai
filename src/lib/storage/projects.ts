import type { Storyboard } from "@/lib/orchestrator/schema";
import { idbDelete, idbGet, idbGetAll, idbPut } from "./db";

export interface AgentLogEntry {
  id: string;
  agent: string;
  providerId: string;
  model: string;
  task: string;
  status: "queued" | "working" | "done" | "failed" | "skipped";
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  retries?: number;
  error?: string;
  sceneIndex?: number;
  costHint?: string;
}

export interface SceneAssets {
  image?: Blob;
  audio?: Blob;
  imageMime?: string;
  audioMime?: string;
  imageUrl?: string;
}

export interface ProjectRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  prompt: string;
  style: string;
  storyboard: Storyboard;
  /** scene index → assets */
  assets: Record<string, SceneAssets>;
  srt: string;
  vtt: string;
  logs: AgentLogEntry[];
  sourceSettings?: unknown;
}

export interface ProjectSummary {
  id: string;
  title: string;
  prompt: string;
  createdAt: number;
  sceneCount: number;
  hasImages: number;
  hasAudio: number;
}

export async function saveProject(project: ProjectRecord): Promise<void> {
  await idbPut("projects", { ...project, updatedAt: Date.now() });
}

export async function getProject(id: string): Promise<ProjectRecord | undefined> {
  return idbGet<ProjectRecord>("projects", id);
}

export async function deleteProject(id: string): Promise<void> {
  await idbDelete("projects", id);
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const all = await idbGetAll<ProjectRecord>("projects");
  return all
    .map((p) => ({
      id: p.id,
      title: p.title,
      prompt: p.prompt,
      createdAt: p.createdAt,
      sceneCount: p.storyboard?.scenes?.length ?? 0,
      hasImages: Object.values(p.assets ?? {}).filter((a) => a.image).length,
      hasAudio: Object.values(p.assets ?? {}).filter((a) => a.audio).length,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}
