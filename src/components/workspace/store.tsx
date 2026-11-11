"use client";

import * as React from "react";
import {
  listKeyRecords,
  readAllKeys,
  readKey,
  removeKey as dbRemoveKey,
  saveKey as dbSaveKey,
  isPassphraseProtected,
  setPassphrase as dbSetPassphrase,
  type EncryptedKeyRecord,
} from "@/lib/storage/keys";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type AppSettings,
} from "@/lib/storage/settings";
import { listProjects, type ProjectSummary } from "@/lib/storage/projects";
import { keyFingerprint } from "@/lib/crypto";
import { uid } from "@/lib/utils";

export type TabType = "chat" | "settings" | "files" | "viewer";

export interface TabState {
  id: string;
  type: TabType;
  title: string;
}

export const TAB_META: Record<TabType, { title: string; icon: string; singleton: boolean }> = {
  chat: { title: "Chat", icon: "message", singleton: false },
  settings: { title: "Settings", icon: "settings", singleton: true },
  files: { title: "Files", icon: "folder", singleton: true },
  viewer: { title: "Project Viewer", icon: "play", singleton: true },
};

const TABS_KEY = "animai.tabs.v1";
const ACTIVE_KEY = "animai.activeTab.v1";
const THEME_KEY = "animai.theme";

function loadTabs(): { tabs: TabState[]; activeId: string } {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    const active = localStorage.getItem(ACTIVE_KEY);
    if (raw) {
      const tabs = JSON.parse(raw) as TabState[];
      if (Array.isArray(tabs) && tabs.length) {
        const safe = tabs.filter((t) => t && typeof t.id === "string" && t.type in TAB_META);
        if (safe.length) {
          const activeId = safe.find((t) => t.id === active)?.id ?? safe[0].id;
          return { tabs: safe, activeId };
        }
      }
    }
  } catch {
    /* ignore */
  }
  const chat: TabState = { id: uid("tab"), type: "chat", title: "Chat" };
  return { tabs: [chat], activeId: chat.id };
}

function persistTabs(tabs: TabState[], activeId: string) {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
    localStorage.setItem(ACTIVE_KEY, activeId);
  } catch {
    /* ignore */
  }
}

export interface WorkspaceStore {
  ready: boolean;
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  replaceSettings: (s: AppSettings) => Promise<void>;

  keyRecords: Record<string, EncryptedKeyRecord>;
  keys: Record<string, string>;
  locked: boolean;
  unlock: (passphrase: string) => Promise<boolean>;
  lock: () => void;
  saveProviderKey: (providerId: string, plain: string) => Promise<void>;
  removeProviderKey: (providerId: string) => Promise<void>;
  setPassphrase: (passphrase: string | null) => Promise<void>;
  refreshKeys: () => Promise<void>;
  hasAnyKeys: boolean;

  tabs: TabState[];
  activeTabId: string;
  openTab: (type: TabType, title?: string) => string;
  closeTab: (id: string) => void;
  moveTab: (fromIndex: number, toIndex: number) => void;
  setActiveTab: (id: string) => void;
  renameTab: (id: string, title: string) => void;

  projects: ProjectSummary[];
  currentProjectId: string | null;
  setCurrentProjectId: (id: string | null) => void;
  refreshProjects: () => Promise<void>;

  theme: "light" | "dark";
  toggleTheme: () => void;
}

const Ctx = React.createContext<WorkspaceStore | null>(null);

export function useWorkspace(): WorkspaceStore {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return ctx;
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = React.useState(false);
  const [settings, setSettings] = React.useState<AppSettings>(DEFAULT_SETTINGS);
  const [keyRecords, setKeyRecords] = React.useState<Record<string, EncryptedKeyRecord>>({});
  const [keys, setKeys] = React.useState<Record<string, string>>({});
  const [locked, setLocked] = React.useState(false);
  const [tabState, setTabState] = React.useState<{ tabs: TabState[]; activeId: string }>(() => ({
    tabs: [],
    activeId: "",
  }));
  const [projects, setProjects] = React.useState<ProjectSummary[]>([]);
  const [currentProjectId, setCurrentProjectId] = React.useState<string | null>(null);
  const [theme, setTheme] = React.useState<"light" | "dark">("dark");
  const passphraseRef = React.useRef<string | null>(null);

  // initial load
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, records, protectedFlag, projectList] = await Promise.all([
          loadSettings(),
          listKeyRecords(),
          isPassphraseProtected(),
          listProjects(),
        ]);
        if (cancelled) return;
        setSettings(s);
        setKeyRecords(Object.fromEntries(records.map((r) => [r.providerId, r])));
        setProjects(projectList);
        setTabState(loadTabs());

        if (records.length && protectedFlag) {
          setLocked(true);
        } else if (records.length) {
          try {
            const loaded = await readAllKeys(null);
            if (!cancelled) setKeys(loaded);
          } catch {
            if (!cancelled) setLocked(true);
          }
        }

        try {
          const storedTheme = localStorage.getItem(THEME_KEY) as "light" | "dark" | null;
          const initial = storedTheme ?? "dark";
          if (!cancelled) {
            setTheme(initial);
            document.documentElement.classList.toggle("dark", initial === "dark");
          }
        } catch {
          /* ignore */
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // persist tabs
  React.useEffect(() => {
    if (!ready || !tabState.tabs.length) return;
    persistTabs(tabState.tabs, tabState.activeId);
  }, [ready, tabState]);

  const refreshProjects = React.useCallback(async () => {
    setProjects(await listProjects());
  }, []);

  const updateSettings = React.useCallback(async (patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      void saveSettings(next);
      return next;
    });
  }, []);

  const replaceSettings = React.useCallback(async (next: AppSettings) => {
    setSettings(next);
    await saveSettings(next);
  }, []);

  const refreshKeys = React.useCallback(async () => {
    const records = await listKeyRecords();
    setKeyRecords(Object.fromEntries(records.map((r) => [r.providerId, r])));
    try {
      const loaded = await readAllKeys(passphraseRef.current);
      setKeys(loaded);
    } catch {
      setLocked(true);
    }
  }, []);

  const saveProviderKey = React.useCallback(
    async (providerId: string, plain: string) => {
      const fp = await keyFingerprint(plain);
      await dbSaveKey(providerId, plain, fp, passphraseRef.current);
      await refreshKeys();
    },
    [refreshKeys]
  );

  const removeProviderKey = React.useCallback(
    async (providerId: string) => {
      await dbRemoveKey(providerId);
      setKeys((prev) => {
        const next = { ...prev };
        delete next[providerId];
        return next;
      });
      await refreshKeys();
    },
    [refreshKeys]
  );

  const unlock = React.useCallback(
    async (passphrase: string) => {
      try {
        const loaded = await readAllKeys(passphrase);
        passphraseRef.current = passphrase;
        setKeys(loaded);
        setLocked(false);
        return true;
      } catch {
        return false;
      }
    },
    []
  );

  const lock = React.useCallback(() => {
    passphraseRef.current = null;
    setKeys({});
    setLocked(true);
  }, []);

  const setPassphrase = React.useCallback(
    async (passphrase: string | null) => {
      await dbSetPassphrase(passphrase, passphraseRef.current);
      passphraseRef.current = passphrase;
      await refreshKeys();
    },
    [refreshKeys]
  );

  const openTab = React.useCallback((type: TabType, title?: string) => {
    let newId = "";
    setTabState((prev) => {
      const meta = TAB_META[type];
      if (meta.singleton) {
        const existing = prev.tabs.find((t) => t.type === type);
        if (existing) {
          newId = existing.id;
          return { ...prev, activeId: existing.id };
        }
      }
      const tab: TabState = { id: uid("tab"), type, title: title ?? meta.title };
      newId = tab.id;
      return { tabs: [...prev.tabs, tab], activeId: tab.id };
    });
    return newId;
  }, []);

  const closeTab = React.useCallback((id: string) => {
    setTabState((prev) => {
      const tabs = prev.tabs.filter((t) => t.id !== id);
      if (!tabs.length) {
        const chat: TabState = { id: uid("tab"), type: "chat", title: "Chat" };
        return { tabs: [chat], activeId: chat.id };
      }
      const activeId =
        prev.activeId === id ? tabs[Math.max(0, prev.tabs.findIndex((t) => t.id === id) - 1)]?.id ?? tabs[0].id : prev.activeId;
      return { tabs, activeId };
    });
  }, []);

  const moveTab = React.useCallback((fromIndex: number, toIndex: number) => {
    setTabState((prev) => {
      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= prev.tabs.length || toIndex >= prev.tabs.length) {
        return prev;
      }
      const tabs = [...prev.tabs];
      const [moved] = tabs.splice(fromIndex, 1);
      tabs.splice(toIndex, 0, moved);
      return { ...prev, tabs };
    });
  }, []);

  const setActiveTab = React.useCallback((id: string) => {
    setTabState((prev) => ({ ...prev, activeId: id }));
  }, []);

  const renameTab = React.useCallback((id: string, title: string) => {
    setTabState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) => (t.id === id ? { ...t, title } : t)),
    }));
  }, []);

  const toggleTheme = React.useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", next === "dark");
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // make sure active tab id is valid
  React.useEffect(() => {
    if (!ready || !tabState.tabs.length) return;
    if (!tabState.tabs.some((t) => t.id === tabState.activeId)) {
      setTabState((prev) => ({ ...prev, activeId: prev.tabs[0].id }));
    }
  }, [ready, tabState.tabs, tabState.activeId]);

  const value: WorkspaceStore = {
    ready,
    settings,
    updateSettings,
    replaceSettings,
    keyRecords,
    keys,
    locked,
    unlock,
    lock,
    saveProviderKey,
    removeProviderKey,
    setPassphrase,
    refreshKeys,
    hasAnyKeys: Object.keys(keyRecords).length > 0,
    tabs: tabState.tabs,
    activeTabId: tabState.activeId,
    openTab,
    closeTab,
    moveTab,
    setActiveTab,
    renameTab,
    projects,
    currentProjectId,
    setCurrentProjectId,
    refreshProjects,
    theme,
    toggleTheme,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
