"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  CircleDashed,
  Loader2,
  RefreshCw,
  SkipForward,
  XCircle,
  Sparkles,
  Image as ImageIcon,
  Type,
  Captions,
  AudioLines,
  Clapperboard,
} from "lucide-react";
import type { AgentTaskState, AgentId } from "@/lib/orchestrator/runner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDuration, cn } from "@/lib/utils";

const AGENT_META: Record<AgentId, { icon: React.ComponentType<{ className?: string }>; color: string }> = {
  planner: { icon: Sparkles, color: "text-violet-400" },
  writer: { icon: Type, color: "text-sky-400" },
  illustrator: { icon: ImageIcon, color: "text-fuchsia-400" },
  captioner: { icon: Captions, color: "text-amber-400" },
  narrator: { icon: AudioLines, color: "text-emerald-400" },
};

function StatusDot({ status }: { status: AgentTaskState["status"] }) {
  switch (status) {
    case "working":
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
    case "done":
      return <CheckCircle2 className="h-3.5 w-3.5 text-success" />;
    case "failed":
      return <XCircle className="h-3.5 w-3.5 text-destructive" />;
    case "skipped":
      return <SkipForward className="h-3.5 w-3.5 text-muted-foreground" />;
    default:
      return <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function statusBadge(status: AgentTaskState["status"]) {
  switch (status) {
    case "working":
      return <Badge variant="info">working</Badge>;
    case "done":
      return <Badge variant="success">done</Badge>;
    case "failed":
      return <Badge variant="destructive">failed</Badge>;
    case "skipped":
      return <Badge variant="outline">skipped</Badge>;
    default:
      return <Badge variant="secondary">queued</Badge>;
  }
}

export function ActivityPanel({
  tasks,
  notices,
  elapsed,
  isRunning,
  onRetry,
}: {
  tasks: Record<string, AgentTaskState>;
  notices: string[];
  elapsed: number;
  isRunning: boolean;
  onRetry: (task: AgentTaskState) => void;
}) {
  const list = React.useMemo(
    () =>
      Object.values(tasks).sort((a, b) => {
        const order: Record<string, number> = { planner: 0, writer: 1, illustrator: 2, captioner: 3, narrator: 4 };
        const d = (order[a.agent] ?? 9) - (order[b.agent] ?? 9);
        if (d !== 0) return d;
        return (a.sceneIndex ?? 0) - (b.sceneIndex ?? 0);
      }),
    [tasks]
  );

  const counts = React.useMemo(() => {
    const c = { queued: 0, working: 0, done: 0, failed: 0, skipped: 0 };
    for (const t of list) c[t.status] += 1;
    return c;
  }, [list]);

  const doneRatio = list.length ? (counts.done + counts.skipped) / list.length : 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <Clapperboard className="h-4 w-4 text-primary" />
          <h3 className="text-xs font-bold uppercase tracking-wider">Agent activity</h3>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {isRunning && <span className="tabular-nums">{formatDuration(elapsed)}</span>}
          <span>
            {counts.done}/{list.length || "—"}
          </span>
        </div>
      </div>

      {list.length > 0 && (
        <div className="h-1 w-full bg-secondary">
          <motion.div
            className="h-full bg-gradient-to-r from-primary to-cyan-400"
            animate={{ width: `${Math.round(doneRatio * 100)}%` }}
            transition={{ type: "spring", stiffness: 120, damping: 20 }}
          />
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 scrollbar-thin">
        {list.length === 0 && (
          <div className="grid h-full place-items-center px-4 text-center">
            <div>
              <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-secondary text-muted-foreground">
                <Clapperboard className="h-6 w-6" />
              </div>
              <p className="text-sm font-medium">Agents idle</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Send a prompt to spin up Planner, Writer, Illustrator, Captioner and Narrator.
              </p>
            </div>
          </div>
        )}

        <AnimatePresence initial={false}>
          {list.map((task) => {
            const meta = AGENT_META[task.agent];
            const Icon = meta.icon;
            return (
              <motion.div
                key={task.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                className={cn(
                  "rounded-xl border p-2.5",
                  task.status === "failed"
                    ? "border-destructive/40 bg-destructive/5"
                    : task.status === "working"
                      ? "border-primary/40 bg-primary/5"
                      : "border-border/70 bg-card/60"
                )}
              >
                <div className="flex items-start gap-2">
                  <div className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-secondary", meta.color)}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-semibold">
                        {task.label}
                        {task.sceneIndex ? <span className="text-muted-foreground"> · #{task.sceneIndex}</span> : null}
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        <StatusDot status={task.status} />
                      </div>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {statusBadge(task.status)}
                      <span className="truncate font-mono text-[10px] text-muted-foreground" title={`${task.providerId} / ${task.model}`}>
                        {task.providerId} · {task.model}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-[11px] text-muted-foreground" title={task.task}>
                      {task.task}
                    </p>
                    {task.progress && (
                      <p className="mt-1 truncate rounded bg-background/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground" title={task.progress}>
                        {task.progress}
                      </p>
                    )}
                    {task.skipReason && (
                      <p className="mt-1 text-[10px] text-warning">Skipped — {task.skipReason}</p>
                    )}
                    {task.error && <p className="mt-1 line-clamp-3 text-[10px] text-destructive">{task.error}</p>}
                    <div className="mt-1.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                      {task.durationMs ? <span>{formatDuration(task.durationMs)}</span> : null}
                      {task.retries ? <span>· retry {task.retries}</span> : null}
                      {task.costHint ? <span className="truncate" title={task.costHint}>· {task.costHint}</span> : null}
                      {(task.status === "failed" || task.status === "done") && task.agent !== "planner" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-auto h-5 px-1.5 text-[10px]"
                          onClick={() => onRetry(task)}
                          title={`Re-run ${task.label}`}
                        >
                          <RefreshCw className="h-3 w-3" /> retry
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {notices.length > 0 && (
          <div className="rounded-xl border border-warning/30 bg-warning/5 p-2.5">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-warning">Skipped / notices</p>
            <ul className="space-y-1">
              {notices.map((n) => (
                <li key={n} className="text-[11px] text-muted-foreground">
                  • {n}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
