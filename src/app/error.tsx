"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Intentionally not logging details that could contain keys.
    void error;
  }, [error]);

  return (
    <div className="grid h-dvh place-items-center bg-background p-6 text-center">
      <div className="max-w-md">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-destructive/15 text-destructive">
          <AlertTriangle className="h-7 w-7" />
        </div>
        <h1 className="text-lg font-bold">Something broke</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          AnimAI Studio hit an unexpected error. Your keys and projects are safe — they only live in this browser.
        </p>
        <button
          onClick={reset}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/25 hover:bg-primary/90"
        >
          <RotateCcw className="h-4 w-4" /> Try again
        </button>
      </div>
    </div>
  );
}
