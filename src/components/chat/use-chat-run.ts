"use client";

import * as React from "react";
import { toast } from "sonner";
import { runFullPipeline } from "@/lib/orchestrator/pipeline";
import {
  illustrateScene,
  narrateScene,
  runCaptioner,
  runWriter,
  type AgentTaskState,
  type RunContext,
} from "@/lib/orchestrator/runner";
import type { Storyboard } from "@/lib/orchestrator/schema";
import { buildSrt, buildVtt } from "@/lib/orchestrator/schema";
import type { AgentLogEntry, ProjectRecord, SceneAssets } from "@/lib/storage/projects";
import { saveProject } from "@/lib/storage/projects";
import { styleLabel } from "@/lib/storage/settings";
import type { StyleId } from "@/lib/storage/settings";
import { uid, isAbortError } from "@/lib/utils";
import { downloadProjectZip } from "@/lib/export/zip";
import { useWorkspace } from "@/components/workspace/store";

export type RunStatus = "idle" | "running" | "done" | "failed" | "cancelled";

export interface ChatRunState {
  id: string;
  status: RunStatus;
  prompt: string;
  startedAt: number;
  endedAt?: number;
  tasks: Record<string, AgentTaskState>;
  storyboard: Storyboard | null;
  assets: Record<string, SceneAssets>;
  notices: string[];
  logs: AgentLogEntry[];
  error?: string;
  projectId?: string;
}

const EMPTY: ChatRunState = {
  id: "",
  status: "idle",
  prompt: "",
  startedAt: 0,
  tasks: {},
  storyboard: null,
  assets: {},
  notices: [],
  logs: [],
};

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
}

export function useChatRun(tabId: string) {
  const { settings, keys, refreshProjects, updateSettings, renameTab } = useWorkspace();
  const [run, setRun] = React.useState<ChatRunState>(EMPTY);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [elapsed, setElapsed] = React.useState(0);

  const dataRef = React.useRef<ChatRunState>(EMPTY);
  const controllerRef = React.useRef<AbortController | null>(null);

  /** Single mutation path: ref first (synchronously), then React state. */
  const mutate = React.useCallback((fn: (prev: ChatRunState) => ChatRunState) => {
    dataRef.current = fn(dataRef.current);
    setRun({ ...dataRef.current });
  }, []);

  React.useEffect(() => {
    if (run.status !== "running") return;
    const t = setInterval(() => setElapsed(Date.now() - dataRef.current.startedAt), 250);
    return () => clearInterval(t);
  }, [run.status]);

  const patchTask = React.useCallback(
    (task: AgentTaskState) => {
      mutate((prev) => ({ ...prev, tasks: { ...prev.tasks, [task.id]: { ...task } } }));
    },
    [mutate]
  );

  const appendLog = React.useCallback(
    (task: AgentTaskState) => {
      const entry: AgentLogEntry = {
        id: uid("log"),
        agent: task.agent,
        providerId: task.providerId,
        model: task.model,
        task: task.task,
        status: task.status,
        startedAt: task.startedAt,
        endedAt: task.endedAt,
        durationMs: task.durationMs,
        retries: task.retries,
        error: task.error,
        sceneIndex: task.sceneIndex,
        costHint: task.costHint,
      };
      mutate((prev) => ({ ...prev, logs: [...prev.logs, entry] }));
    },
    [mutate]
  );

  const notice = React.useCallback(
    (message: string) => {
      mutate((prev) => (prev.notices.includes(message) ? prev : { ...prev, notices: [...prev.notices, message] }));
    },
    [mutate]
  );

  const buildCtx = React.useCallback(
    (signal: AbortSignal): RunContext => ({
      settings,
      keys,
      prompt: dataRef.current.prompt || "",
      style: settings.style,
      signal,
      onTask: patchTask,
      onStoryboard: (sb) => mutate((prev) => ({ ...prev, storyboard: sb })),
      onSceneText: (index, patch) =>
        mutate((prev) =>
          prev.storyboard
            ? {
                ...prev,
                storyboard: {
                  ...prev.storyboard,
                  scenes: prev.storyboard.scenes.map((s) => (s.index === index ? { ...s, ...patch } : s)),
                },
              }
            : prev
        ),
      onSceneAsset: (index, kind, blob, mime) =>
        mutate((prev) => {
          const key = String(index);
          const current = prev.assets[key] ?? {};
          return {
            ...prev,
            assets: {
              ...prev.assets,
              [key]: {
                ...current,
                [kind]: blob,
                [kind === "image" ? "imageMime" : "audioMime"]: mime,
              },
            },
          };
        }),
      onLog: appendLog,
      onNotice: notice,
    }),
    [settings, keys, patchTask, appendLog, notice, mutate]
  );

  const finalize = React.useCallback(
    async (state: ChatRunState): Promise<ProjectRecord | null> => {
      if (!state.storyboard) return null;
      const project: ProjectRecord = {
        id: uid("prj"),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        title: state.storyboard.title,
        prompt: state.prompt,
        style: state.storyboard.style ?? settings.style,
        storyboard: state.storyboard,
        assets: state.assets,
        srt: buildSrt(state.storyboard.scenes),
        vtt: buildVtt(state.storyboard.scenes),
        logs: state.logs,
        sourceSettings: { style: settings.style, sceneCount: settings.sceneCount },
      };
      await saveProject(project);
      await refreshProjects();
      mutate((prev) => ({ ...prev, projectId: project.id }));
      renameTab(tabId, project.title.slice(0, 24));
      if (settings.autoDownload) {
        try {
          await downloadProjectZip(project);
          toast.success("ZIP downloaded automatically");
        } catch {
          /* ignore auto-download errors */
        }
      }
      return project;
    },
    [settings, refreshProjects, renameTab, tabId, mutate]
  );

  const start = React.useCallback(
    async (prompt: string) => {
      if (!prompt.trim()) return;
      if (Object.keys(keys).length === 0) {
        toast.error("No API keys yet", { description: "Open Settings and add at least one key." });
        return;
      }
      const controller = new AbortController();
      controllerRef.current = controller;

      setMessages((prev) => [...prev, { id: uid("msg"), role: "user", text: prompt, at: Date.now() }]);
      dataRef.current = { ...EMPTY, id: uid("run"), status: "running", prompt, startedAt: Date.now() };
      setRun({ ...dataRef.current });
      setElapsed(0);

      try {
        const ctx = buildCtx(controller.signal);
        const storyboard = await runFullPipeline(ctx);
        if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
        if (!storyboard) throw new Error("Planning failed — check your text provider key and model");

        mutate((prev) => ({ ...prev, storyboard, status: "done", endedAt: Date.now() }));
        await finalize(dataRef.current);

        setMessages((prev) => [
          ...prev,
          {
            id: uid("msg"),
            role: "assistant",
            text: `Done — “${storyboard.title}” (${storyboard.scenes.length} scenes).`,
            at: Date.now(),
          },
        ]);
        toast.success("Creative package ready", { description: storyboard.title });
      } catch (err) {
        if (isAbortError(err)) {
          mutate((prev) => ({ ...prev, status: "cancelled", endedAt: Date.now() }));
          toast.info("Run cancelled");
          if (dataRef.current.storyboard) void finalize(dataRef.current);
        } else {
          const message = err instanceof Error ? err.message : String(err);
          mutate((prev) => ({ ...prev, status: "failed", error: message, endedAt: Date.now() }));
          setMessages((prev) => [...prev, { id: uid("msg"), role: "assistant", text: `Run failed: ${message}`, at: Date.now() }]);
          toast.error("Run failed", { description: message });
        }
      } finally {
        controllerRef.current = null;
      }
    },
    [keys, buildCtx, finalize, mutate]
  );

  const cancel = React.useCallback(() => controllerRef.current?.abort(), []);

  const retryTask = React.useCallback(
    async (task: AgentTaskState) => {
      const current = dataRef.current;
      if (!current.storyboard || current.status === "running") return;
      const controller = new AbortController();
      controllerRef.current = controller;
      mutate((prev) => ({ ...prev, status: "running", error: undefined }));

      const ctx = buildCtx(controller.signal);
      try {
        if (task.agent === "illustrator") {
          const scene = current.storyboard.scenes.find((s) => s.index === task.sceneIndex);
          if (scene) await illustrateScene(ctx, scene);
        } else if (task.agent === "narrator") {
          const scene = current.storyboard.scenes.find((s) => s.index === task.sceneIndex);
          if (scene) await narrateScene(ctx, scene);
        } else if (task.agent === "writer") {
          const sb = await runWriter(ctx, current.storyboard);
          mutate((prev) => ({ ...prev, storyboard: sb }));
        } else if (task.agent === "captioner") {
          const sb = await runCaptioner(ctx, current.storyboard);
          mutate((prev) => ({ ...prev, storyboard: sb }));
        } else {
          toast.info("Start a new run to re-plan from scratch");
          mutate((prev) => ({ ...prev, status: current.status }));
          return;
        }
        mutate((prev) => ({ ...prev, status: "done", endedAt: Date.now() }));
        toast.success(`${task.label} re-run complete`);
      } catch (err) {
        const message = isAbortError(err) ? "Cancelled" : err instanceof Error ? err.message : String(err);
        mutate((prev) => ({ ...prev, status: message === "Cancelled" ? "cancelled" : "failed", error: message }));
        toast.error(`${task.label} failed`, { description: message });
      } finally {
        controllerRef.current = null;
      }
    },
    [buildCtx, mutate]
  );

  const regenerateScene = React.useCallback(
    async (sceneIndex: number, what: "image" | "audio") => {
      const current = dataRef.current;
      if (!current.storyboard) return;
      const controller = new AbortController();
      controllerRef.current = controller;
      const ctx = buildCtx(controller.signal);
      const scene = current.storyboard.scenes.find((s) => s.index === sceneIndex);
      if (!scene) return;
      try {
        if (what === "image") await illustrateScene(ctx, scene);
        else await narrateScene(ctx, scene);
        toast.success(`Scene ${sceneIndex} ${what} regenerated`);
      } catch (err) {
        toast.error(`Scene ${sceneIndex} failed`, { description: err instanceof Error ? err.message : String(err) });
      } finally {
        controllerRef.current = null;
      }
    },
    [buildCtx]
  );

  const clear = React.useCallback(() => {
    controllerRef.current?.abort();
    dataRef.current = EMPTY;
    setRun(EMPTY);
    setMessages([]);
    setElapsed(0);
  }, []);

  const saveCurrent = React.useCallback(async () => {
    await finalize(dataRef.current);
    toast.success("Project saved to Files");
  }, [finalize]);

  return {
    run,
    messages,
    elapsed,
    start,
    cancel,
    clear,
    retryTask,
    regenerateScene,
    saveCurrent,
    setMessages,
    isRunning: run.status === "running",
    setStyle: (style: StyleId) => void updateSettings({ style }),
    styleLabel: styleLabel(settings.style),
  };
}
