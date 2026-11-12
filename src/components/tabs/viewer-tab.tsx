"use client";

import * as React from "react";
import { Download, FileText, FolderOpen, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { getProject, type ProjectRecord } from "@/lib/storage/projects";
import { buildProjectHtml } from "@/lib/export/project";
import { downloadProjectHtml, downloadProjectZip } from "@/lib/export/zip";
import { useWorkspace } from "@/components/workspace/store";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function ViewerTab() {
  const { currentProjectId, openTab } = useWorkspace();
  const [project, setProject] = React.useState<ProjectRecord | null>(null);
  const [html, setHtml] = React.useState<string>("");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string>("");

  const load = React.useCallback(async () => {
    if (!currentProjectId) {
      setLoading(false);
      setProject(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const rec = await getProject(currentProjectId);
      if (!rec) throw new Error("Project not found — it may have been deleted");
      setProject(rec);
      setHtml(await buildProjectHtml(rec));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to render project");
    } finally {
      setLoading(false);
    }
  }, [currentProjectId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-bold" title={project?.title}>
            {project?.title ?? "Project Viewer"}
          </h1>
          <p className="truncate text-[11px] text-muted-foreground">
            {project ? `${project.storyboard.scenes.length} scenes · self-contained project.html` : "No project selected"}
          </p>
        </div>

        {project && (
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" className="h-7" onClick={() => void load()} title="Rebuild viewer">
              <RefreshCw className="h-3 w-3" /> Rebuild
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              onClick={async () => {
                try {
                  await downloadProjectZip(project);
                  toast.success("ZIP downloaded");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Failed");
                }
              }}
            >
              <Download className="h-3 w-3" /> ZIP
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              onClick={async () => {
                try {
                  await downloadProjectHtml(project);
                  toast.success("HTML downloaded");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Failed");
                }
              }}
            >
              <FileText className="h-3 w-3" /> HTML
            </Button>
            <Button size="sm" className="h-7" onClick={() => openTab("files")}>
              <FolderOpen className="h-3 w-3" /> Files
            </Button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 bg-background/60">
        {loading ? (
          <div className="space-y-4 p-6">
            <Skeleton className="h-8 w-1/2 rounded-lg" />
            <Skeleton className="h-64 w-full rounded-2xl" />
            <Skeleton className="h-40 w-full rounded-2xl" />
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Rendering self-contained viewer…
            </p>
          </div>
        ) : error ? (
          <div className="grid h-full place-items-center p-6 text-center">
            <div>
              <p className="text-sm font-medium text-destructive">{error}</p>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => openTab("files")}>
                Back to Files
              </Button>
            </div>
          </div>
        ) : !project ? (
          <div className="grid h-full place-items-center p-6 text-center">
            <div>
              <p className="text-sm font-medium">Nothing to preview</p>
              <p className="mt-1 text-xs text-muted-foreground">Run a project in Chat or open one from Files.</p>
              <div className="mt-4 flex justify-center gap-2">
                <Button size="sm" onClick={() => openTab("chat")}>
                  Go to Chat
                </Button>
                <Button size="sm" variant="outline" onClick={() => openTab("files")}>
                  Open Files
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <iframe
            key={project.id + html.length}
            title="Project viewer"
            srcDoc={html}
            sandbox="allow-same-origin"
            className="h-full w-full border-0"
          />
        )}
      </div>
    </div>
  );
}
