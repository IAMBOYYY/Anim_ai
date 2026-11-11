"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Lock, Moon, Sun, Zap } from "lucide-react";
import { useWorkspace, TAB_META } from "./store";
import { TabBar, TabHint } from "./tab-bar";
import { Button } from "@/components/ui/button";
import { ChatTab } from "@/tabs/chat-tab";
import { SettingsTab } from "@/tabs/settings-tab";
import { FilesTab } from "@/tabs/files-tab";
import { ViewerTab } from "@/tabs/viewer-tab";
import { UnlockDialog } from "./unlock-dialog";
import { useKeyboardShortcuts } from "./shortcuts";

export function Workspace() {
  const { ready, tabs, activeTabId, theme, toggleTheme, locked, lock, openTab } = useWorkspace();
  useKeyboardShortcuts();

  if (!ready) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Loading workspace…</p>
      </div>
    );
  }

  return (
    <div className="relative z-10 flex h-dvh flex-col">
      <header className="glass-strong sticky top-0 z-30 flex items-center gap-3 border-b border-border/60 px-3 py-2">
        <button
          onClick={() => openTab("chat")}
          className="flex items-center gap-2 rounded-lg px-1 py-0.5 text-left transition-opacity hover:opacity-80"
          title="New chat"
        >
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-primary to-cyan-400 text-sm font-black text-white shadow-lg shadow-primary/30">
            A
          </span>
          <span className="hidden text-sm font-bold tracking-tight sm:block">
            Anim<span className="text-gradient">AI</span> Studio
          </span>
        </button>

        <div className="min-w-0 flex-1 overflow-hidden">
          <TabBar />
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <span className="hidden xl:block">
            <TabHint />
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggleTheme}
            aria-label="Toggle theme"
            title="Toggle light / dark theme"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={lock} aria-label="Lock keys" title="Lock API keys" className={locked ? "opacity-50" : ""}>
            <Lock className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="relative min-h-0 flex-1 overflow-hidden">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className={cnAbsolute(active)}
              aria-hidden={!active}
              id={`tabpanel-${tab.id}`}
            >
              <TabContent tabType={tab.type} tabId={tab.id} />
            </div>
          );
        })}

        <AnimatePresence>
          {locked && (
            <motion.div key="unlock" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <UnlockDialog />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <StatusStrip />
    </div>
  );
}

function cnAbsolute(active: boolean): string {
  return active ? "h-full w-full" : "hidden";
}

function TabContent({ tabType, tabId }: { tabType: keyof typeof TAB_META; tabId: string }) {
  switch (tabType) {
    case "chat":
      return <ChatTab tabId={tabId} />;
    case "settings":
      return <SettingsTab />;
    case "files":
      return <FilesTab />;
    case "viewer":
      return <ViewerTab />;
    default:
      return null;
  }
}

function StatusStrip() {
  const { hasAnyKeys, settings } = useWorkspace();
  return (
    <footer className="glass-strong flex items-center justify-between gap-3 border-t border-border/60 px-3 py-1 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <Zap className="h-3 w-3 text-warning" />
        {hasAnyKeys ? "Keys stored encrypted in this browser" : "No API keys yet — open Settings"}
      </span>
      <span className="hidden sm:block">
        {settings.sceneCount} scenes · {settings.style} · client-side only
      </span>
    </footer>
  );
}
