"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { AudioLines, ImageDown, Loader2, RefreshCw, Sparkles } from "lucide-react";
import type { Scene } from "@/lib/orchestrator/schema";
import type { SceneAssets } from "@/lib/storage/projects";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function useObjectUrl(blob: Blob | undefined): string | null {
  const [url, setUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

export function SceneCard({
  scene,
  assets,
  busy,
  onRegenerate,
  index,
}: {
  scene: Scene;
  assets?: SceneAssets;
  busy?: boolean;
  onRegenerate: (what: "image" | "audio") => void;
  index: number;
}) {
  const [showPrompt, setShowPrompt] = React.useState(false);
  const imageUrl = useObjectUrl(assets?.image);
  const audioUrl = useObjectUrl(assets?.audio);

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.05, 0.4), duration: 0.3 }}
      className="glass overflow-hidden rounded-2xl"
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-secondary/60 sm:aspect-[16/10]">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={scene.title} className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full place-items-center gap-2 text-muted-foreground">
            {busy ? (
              <>
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <span className="text-xs">Illustrating scene…</span>
              </>
            ) : (
              <>
                <ImageDown className="h-6 w-6 opacity-50" />
                <span className="text-xs">No image</span>
              </>
            )}
          </div>
        )}
        <div className="absolute left-2 top-2 flex items-center gap-1.5">
          <Badge className="shadow-lg">{String(scene.index).padStart(2, "0")}</Badge>
          <Badge variant="secondary" className="bg-black/50 text-white backdrop-blur">
            {scene.durationSec}s
          </Badge>
        </div>
        <div className="absolute bottom-2 right-2 flex gap-1">
          <Button
            size="sm"
            variant="secondary"
            className="h-7 gap-1 bg-black/55 text-white backdrop-blur hover:bg-black/70"
            onClick={() => onRegenerate("image")}
            disabled={busy}
            title="Regenerate this image only"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} image
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="h-7 gap-1 bg-black/55 text-white backdrop-blur hover:bg-black/70"
            onClick={() => onRegenerate("audio")}
            disabled={busy}
            title="Re-narrate this scene only"
          >
            <AudioLines className="h-3 w-3" /> voice
          </Button>
        </div>
      </div>

      <div className="space-y-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold leading-tight">{scene.title}</h3>
          {scene.caption && (
            <span className="max-w-[45%] shrink-0 truncate text-right text-[11px] font-medium text-primary" title={scene.caption}>
              “{scene.caption}”
            </span>
          )}
        </div>
        <p className="text-[13px] leading-relaxed text-muted-foreground">{scene.narration}</p>

        {audioUrl ? (
          <audio src={audioUrl} controls preload="metadata" className="h-8 w-full" />
        ) : (
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
            <AudioLines className="h-3 w-3" /> no narration audio
          </p>
        )}

        <button
          onClick={() => setShowPrompt((v) => !v)}
          className={cn(
            "flex w-full items-center gap-1.5 rounded-md bg-background/50 px-2 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:text-foreground",
            showPrompt && "text-foreground"
          )}
        >
          <Sparkles className="h-3 w-3 text-fuchsia-400" />
          {showPrompt ? "Hide image prompt" : "Show image prompt"}
        </button>
        {showPrompt && (
          <p className="rounded-md border border-border bg-background/60 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
            {scene.imagePrompt}
          </p>
        )}
      </div>
    </motion.article>
  );
}
