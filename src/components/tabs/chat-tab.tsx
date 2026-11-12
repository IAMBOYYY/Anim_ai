"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Download,
  FileJson,
  FileText,
  Hammer,
  History,
  Loader2,
  Play,
  Send,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useChatRun } from "@/components/chat/use-chat-run";
import { ActivityPanel } from "@/components/chat/activity-panel";
import { SceneCard } from "@/components/chat/scene-card";
import { useWorkspace } from "@/components/workspace/store";
import { PROMPT_STYLES, type StyleId } from "@/lib/storage/settings";
import { getProject } from "@/lib/storage/projects";
import { downloadProjectZip, downloadProjectHtml } from "@/lib/export/zip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn, formatDuration } from "@/lib/utils";

const TEMPLATES: { label: string; prompt: string }[] = [
  { label: "30s animated story", prompt: "Make a 30s animated story about a lonely robot who finds a glowing seed in a dead city" },
  { label: "Product ad", prompt: "Create a punchy 20s product ad for a solar-powered backpack aimed at hikers" },
  { label: "Music video", prompt: "Storyboard a 45s music video about dancing through the seasons in a neon city" },
  { label: "Explainer", prompt: "Explain how honey is made in a charming 30s animated explainer for kids" },
];

export function ChatTab({ tabId }: { tabId: string }) {
  const { settings, openTab, setCurrentProjectId, updateSettings } = useWorkspace();
  const {
    run,
    messages,
    elapsed,
    start,
    cancel,
    clear,
    retryTask,
    regenerateScene,
    saveCurrent,
    isRunning,
    setStyle,
    styleLabel,
  } = useChatRun(tabId);

  const [input, setInput] = React.useState("");
  const [panelOpen, setPanelOpen] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, run.storyboard, run.notices.length]);

  // Esc cancels a running job
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isRunning) cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isRunning, cancel]);

  const submit = () => {
    if (isRunning) return;
    const prompt = input.trim();
    if (!prompt) return;
    setInput("");
    void start(prompt);
  };

  const scenes = run.storyboard?.scenes ?? [];
  const done = run.status === "done" || run.status === "cancelled";

  const downloadZip = async () => {
    const project = run.projectId ? await getProject(run.projectId) : null;
    if (!project) return toast.error("No project to export yet");
    try {
      await downloadProjectZip(project);
      toast.success("ZIP downloaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    }
  };

  const downloadHtml = async () => {
    const project = run.projectId ? await getProject(run.projectId) : null;
    if (!project) return toast.error("No project to export yet");
    try {
      await downloadProjectHtml(project);
      toast.success("project.html downloaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    }
  };

  const downloadJson = async () => {
    const project = run.projectId ? await getProject(run.projectId) : null;
    if (!project) return toast.error("No project to export yet");
    const { buildExportProject } = await import("@/lib/export/project");
    const data = await buildExportProject(project);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "project.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const openInViewer = async () => {
    if (!run.projectId) return toast.error("Finish a run first");
    setCurrentProjectId(run.projectId);
    openTab("viewer");
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* scroll area */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          <div className="mx-auto max-w-3xl px-4 py-5">
            {/* empty state */}
            {messages.length === 0 && run.status === "idle" && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="py-6 text-center">
                <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-primary to-cyan-400 text-white shadow-xl shadow-primary/30">
                  <Hammer className="h-7 w-7" />
                </div>
                <h2 className="text-xl font-bold tracking-tight">
                  Direct your <span className="text-gradient">AI crew</span>
                </h2>
                <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                  One prompt → a plan, story, images, captions and narration. Each step runs on the provider you pick
                  in Settings.
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {TEMPLATES.map((t) => (
                    <button
                      key={t.label}
                      onClick={() => {
                        setInput(t.prompt);
                        inputRef.current?.focus();
                      }}
                      className="rounded-full border border-border bg-card/70 px-3 py-1.5 text-xs transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:text-primary"
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => openTab("settings")}
                  className="mt-5 text-xs text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-primary"
                >
                  Add an API key first →
                </button>
              </motion.div>
            )}

            {/* messages */}
            {messages.map((m) => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn("mb-4 flex", m.role === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                    m.role === "user"
                      ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
                      : "glass text-foreground"
                  )}
                >
                  <p className="whitespace-pre-wrap break-words">{m.text}</p>
                </div>
              </motion.div>
            ))}

            {/* run header */}
            {run.status !== "idle" && (
              <motion.div layout className="glass mb-4 rounded-2xl p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={run.status === "failed" ? "destructive" : run.status === "running" ? "info" : run.status === "cancelled" ? "warning" : "success"}>
                    {run.status}
                  </Badge>
                  <span className="truncate text-sm font-medium">{run.prompt}</span>
                  <span className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
                    {run.status === "running" && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                    {formatDuration(elapsed)}
                  </span>
                </div>
                {run.error && <p className="mt-2 text-xs text-destructive">{run.error}</p>}
                {run.notices.length > 0 && (
                  <p className="mt-2 text-[11px] text-warning">
                    {run.notices.length} step{run.notices.length > 1 ? "s" : ""} skipped — see activity panel
                  </p>
                )}
                {done && scenes.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => void downloadZip()}>
                      <Download className="h-3.5 w-3.5" /> ZIP
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void downloadHtml()}>
                      <FileText className="h-3.5 w-3.5" /> project.html
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void downloadJson()}>
                      <FileJson className="h-3.5 w-3.5" /> project.json
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void openInViewer()} disabled={!run.projectId}>
                      <Play className="h-3.5 w-3.5" /> Open in Viewer
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void saveCurrent()}>
                      <History className="h-3.5 w-3.5" /> Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={clear}>
                      <Trash2 className="h-3.5 w-3.5" /> Clear
                    </Button>
                  </div>
                )}
              </motion.div>
            )}

            {/* storyboard scenes */}
            {scenes.length > 0 && (
              <>
                <div className="mb-3 flex items-center gap-3">
                  <h2 className="text-base font-bold">{run.storyboard?.title}</h2>
                  <span className="text-xs text-muted-foreground">{scenes.length} scenes</span>
                  <Separator className="flex-1" />
                </div>
                {run.storyboard?.synopsis && (
                  <p className="mb-4 text-sm text-muted-foreground">{run.storyboard.synopsis}</p>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  {scenes.map((scene, i) => (
                    <SceneCard
                      key={scene.index}
                      index={i}
                      scene={scene}
                      assets={run.assets[String(scene.index)]}
                      busy={isRunning && run.tasks[`illustrator:${scene.index}`]?.status === "working"}
                      onRegenerate={(what) => void regenerateScene(scene.index, what)}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* composer */}
        <div className="border-t border-border/60 bg-background/40 px-4 py-3 backdrop-blur-xl">
          <div className="mx-auto max-w-3xl">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <select
                value={settings.style}
                onChange={(e) => setStyle(e.target.value as StyleId)}
                className="h-8 rounded-lg border border-border bg-card px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                aria-label="Visual style"
              >
                {PROMPT_STYLES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.emoji} {s.label}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                scenes
                <input
                  type="number"
                  min={2}
                  max={16}
                  defaultValue={settings.sceneCount}
                  onBlur={(e) => {
                    const v = Math.max(2, Math.min(16, Number(e.target.value) || 6));
                    void updateSettings({ sceneCount: v });
                  }}
                  className="h-7 w-14 rounded-md border border-border bg-card px-1.5 text-center text-xs outline-none focus:ring-1 focus:ring-ring"
                />
              </label>
              <span className="ml-auto hidden text-[11px] text-muted-foreground sm:block">
                {styleLabel} · {isRunning ? "Esc to cancel" : "Ctrl+Enter to send"}
              </span>
            </div>

            <div className="relative">
              <Textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder='Describe your project… e.g. "make a 30s animated story about a robot gardener"'
                className="min-h-[64px] resize-none pr-24 text-sm"
                disabled={isRunning}
              />
              <div className="absolute bottom-2 right-2 flex gap-1.5">
                {isRunning ? (
                  <Button size="sm" variant="destructive" onClick={cancel}>
                    <Square className="h-3.5 w-3.5" /> Stop
                  </Button>
                ) : (
                  <Button size="sm" onClick={submit} disabled={!input.trim()}>
                    <Send className="h-3.5 w-3.5" /> Run
                  </Button>
                )}
              </div>
            </div>

            {/* mobile activity toggle */}
            <div className="mt-2 flex items-center justify-between lg:hidden">
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setPanelOpen(true)}>
                Agent activity
                {Object.values(run.tasks).filter((t) => t.status === "working").length > 0 && (
                  <Badge variant="info" className="ml-1">
                    live
                  </Badge>
                )}
              </Button>
              <span className="text-[10px] text-muted-foreground">{Object.keys(run.tasks).length} tasks</span>
            </div>
          </div>
        </div>
      </div>

      {/* desktop activity panel */}
      <aside className="hidden w-[320px] shrink-0 border-l border-border/60 bg-card/40 lg:block">
        <ActivityPanel
          tasks={run.tasks}
          notices={run.notices}
          elapsed={elapsed}
          isRunning={isRunning}
          onRetry={(t) => void retryTask(t)}
        />
      </aside>

      {/* mobile activity sheet */}
      <AnimatePresence>
        {panelOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/60 lg:hidden"
            onClick={() => setPanelOpen(false)}
          >
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 260, damping: 30 }}
              className="absolute inset-x-0 bottom-0 h-[75dvh] rounded-t-3xl border-t border-border bg-popover"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-center py-2">
                <div className="h-1 w-10 rounded-full bg-border" />
              </div>
              <div className="absolute right-3 top-2">
                <Button size="icon-sm" variant="ghost" onClick={() => setPanelOpen(false)} aria-label="Close">
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="h-[calc(75dvh-36px)]">
                <ActivityPanel
                  tasks={run.tasks}
                  notices={run.notices}
                  elapsed={elapsed}
                  isRunning={isRunning}
                  onRetry={(t) => void retryTask(t)}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
