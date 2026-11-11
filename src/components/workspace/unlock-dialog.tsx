"use client";

import * as React from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { useWorkspace } from "./store";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export function UnlockDialog() {
  const { unlock } = useWorkspace();
  const [passphrase, setPassphrase] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphrase) return;
    setBusy(true);
    const ok = await unlock(passphrase);
    setBusy(false);
    if (ok) {
      setPassphrase("");
      toast.success("Keys unlocked for this session");
    } else {
      toast.error("Wrong passphrase");
    }
  };

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <div className="mb-1 grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary">
            <KeyRound className="h-5 w-5" />
          </div>
          <DialogTitle>Unlock your API keys</DialogTitle>
          <DialogDescription>
            Your keys are encrypted with a passphrase using WebCrypto (AES-GCM + PBKDF2). The passphrase never leaves
            this device.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Input
            type="password"
            autoFocus
            placeholder="Passphrase"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoComplete="current-password"
          />
          <div className="flex items-start gap-2 rounded-lg border border-border bg-secondary/50 p-2.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
            Forgetting the passphrase means the stored keys can’t be recovered — you can remove them from IndexedDB
            and re-enter them.
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy || !passphrase} className="w-full sm:w-auto">
              {busy ? "Unlocking…" : "Unlock"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
