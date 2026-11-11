"use client";

import * as React from "react";
import { useWorkspace } from "./store";

/**
 * Global keyboard shortcuts:
 *  Ctrl/Cmd + 1..4   → switch to tab at that position
 *  Ctrl/Cmd + Shift + N → new Chat tab
 *  Ctrl/Cmd + Shift + L → toggle light/dark theme
 *  Ctrl/Cmd + Shift + S → open Settings
 *  Esc               → cancel running job (handled by ChatTab)
 */
export function useKeyboardShortcuts() {
  const { tabs, setActiveTab, openTab, toggleTheme } = useWorkspace();

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const target = e.target as HTMLElement | null;
      const inField =
        target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if (e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        openTab("chat");
        return;
      }
      if (e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        toggleTheme();
        return;
      }
      if (e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        openTab("settings");
        return;
      }
      if (!e.shiftKey && /^[1-9]$/.test(e.key) && !inField) {
        const idx = Number(e.key) - 1;
        const tab = tabs[idx];
        if (tab) {
          e.preventDefault();
          setActiveTab(tab.id);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [tabs, setActiveTab, openTab, toggleTheme]);
}
