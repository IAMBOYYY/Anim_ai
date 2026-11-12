"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  Download,
  FolderOpen,
  Image as ImageIcon,
  AudioLines,
  Play,
  Trash2,
  FileJson,
} from "lucide-react";
import { toast } from "sonner";
import { deleteProject, getProject, type ProjectSummary } from "@/lib/storage/projects";
import { useWorkspace } from "@/components/workspace/store";
import { downloadProjectZip, downloadProjectHtml } from "@/lib/export/zip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, cn } from "@/lib/utils";

export function FilesTab() {
  const { projects, refreshProjects, setCurrentProjectId, openTab, ready } = useWorkspace();
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const open = (id: string) => {
    setCurrentProjectId(id);
    openTab("viewer");
  };

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      await deleteProject(id);
      await refreshProjects();
      toast.success("Project deleted");
    } catch {
      toast.error("Delete failed");
    } finally {
      setBusyId(null);
    }
  };

  const exportOne = async (summary: ProjectSummary, kind: "zip" | "html" | "json") => {
    setBusyId(summary.id);
    try {
      const project = await getProject(summary.id);
      if (!project) throw new Error("Project not found");
      if (kind === "zip") await downloadProjectZip(project);
      else if (kind === "html") await downloadProjectHtml(project);
      else {
        const { buildExportProject } = await import("@/lib/export/project");
        const data = await buildExportProject(project);
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${summary.title || "project"}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
      toast.success(`Downloaded ${kind.toUpperCase()}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Files</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Past projects live in your browser’s IndexedDB — nothing is uploaded.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => void refreshProjects()}>
            Refresh
          </Button>
        </div>

        {!ready ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-40 rounded-2xl" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid place-items-center rounded-3xl border border-dashed border-border py-16 text-center"
          >
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-secondary text-muted-foreground">
              <FolderOpen className="h-7 w-7" />
            </div>
            <h2 className="mt-4 text-base font-semibold">No projects yet</h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Run a prompt in Chat and your finished packages will appear here for reopening and re-download.
            </p>
            <Button className="mt-4" size="sm" onClick={() => openTab("chat")}>
              Start creating
            </Button>
          </motion.div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p, i) => (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.04, 0.3) }}
              >
                <Card className="group h-full transition-all hover:-translate-y-0.5 hover:border-primary/40">
                  <CardContent className="flex h-full flex-col gap-3 p-4">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold" title={p.title}>
                        {p.title}
                      </h3>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{p.prompt}</p>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="secondary">{p.sceneCount} scenes</Badge>
                      <Badge variant="outline">
                        <ImageIcon className="h-3 w-3" /> {p.hasImages}
                      </Badge>
                      <Badge variant="outline">
                        <AudioLines className="h-3 w-3" /> {p.hasAudio}
                      </Badge>
                    </div>

                    <p className="text-[11px] text-muted-foreground">{formatDate(p.createdAt)}</p>

                    <div className="mt-auto flex flex-wrap gap-1.5">
                      <Button size="sm" className="h-7" onClick={() => open(p.id)}>
                        <Play className="h-3 w-3" /> Open
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7"
                        disabled={busyId === p.id}
                        onClick={() => void exportOne(p, "zip")}
                      >
                        <Download className="h-3 w-3" /> ZIP
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7"
                        disabled={busyId === p.id}
                        onClick={() => void exportOne(p, "html")}
                        title="Download self-contained viewer"
                      >
                        <FileJson className="h-3 w-3" /> HTML
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className={cn("h-7 px-2 text-destructive", busyId === p.id && "opacity-50")}
                        onClick={() => void remove(p.id)}
                        title="Delete project"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
