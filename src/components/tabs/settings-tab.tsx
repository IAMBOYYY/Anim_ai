"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  Download,
  ExternalLink,
  KeyRound,
  Loader2,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { getAdapter } from "@/lib/providers/registry";
import { groupByCapability } from "@/lib/providers/capabilities";
import type { Capability, ModelInfo, ProviderAdapter } from "@/lib/providers/types";
import { CAPABILITIES } from "@/lib/providers/types";
import { availableRoutes } from "@/lib/storage/settings";
import { useWorkspace, type TabType } from "@/components/workspace/store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { cn, formatDate } from "@/lib/utils";
import { PROVIDERS } from "@/lib/providers/registry";

const CAP_LABEL: Record<Capability, string> = {
  text: "Text",
  image: "Image",
  video: "Video",
  audio: "Audio",
};

interface ModelCacheEntry {
  models: ModelInfo[];
  fetchedAt: number;
}

export function SettingsTab() {
  const { settings, updateSettings, replaceSettings, keyRecords, keys, saveProviderKey, removeProviderKey, setPassphrase, hasAnyKeys } =
    useWorkspace();
  const [modelCache, setModelCache] = React.useState<Record<string, ModelCacheEntry>>({});
  const [busy, setBusy] = React.useState<Record<string, "validate" | "list" | undefined>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const fileRef = React.useRef<HTMLInputElement>(null);

  const getAdapterFor = (id: string): ProviderAdapter | undefined =>
    getAdapter(id, { customBaseUrl: settings.providers[id]?.customBaseUrl });

  const persistProvider = async (providerId: string, patch: Partial<{ enabled: boolean; customBaseUrl: string }>) => {
    const current = settings.providers[providerId] ?? { enabled: true, models: {} };
    await updateSettings({
      providers: { ...settings.providers, [providerId]: { ...current, ...patch } },
    });
  };

  const setDefaultModel = async (providerId: string, capability: Capability, modelId: string | null) => {
    const current = settings.providers[providerId] ?? { enabled: true, models: {} };
    const models = { ...current.models };
    if (modelId) models[capability] = modelId;
    else delete models[capability];
    await updateSettings({ providers: { ...settings.providers, [providerId]: { ...current, models } } });
  };

  const runValidateAndList = async (providerId: string, keyOverride?: string) => {
    const adapter = getAdapterFor(providerId);
    if (!adapter) return;
    const key = keyOverride ?? keys[providerId];
    if (!key) {
      setErrors((e) => ({ ...e, [providerId]: "Enter an API key first" }));
      return;
    }
    if (adapter.keyPattern && !adapter.keyPattern.test(key.trim())) {
      setErrors((e) => ({ ...e, [providerId]: `Key doesn’t look like a ${adapter.name} key (expected ${adapter.keyHint})` }));
      return;
    }
    setBusy((b) => ({ ...b, [providerId]: "validate" }));
    setErrors((e) => ({ ...e, [providerId]: "" }));
    try {
      const result = await adapter.validate(key.trim());
      setBusy((b) => ({ ...b, [providerId]: "list" }));
      const models = await adapter.listModels(key.trim());
      setModelCache((c) => ({ ...c, [providerId]: { models, fetchedAt: Date.now() } }));
      if (keyOverride) await saveProviderKey(providerId, key.trim());

      // convenience: pre-select the first model of each capability not yet chosen
      const currentPs = settings.providers[providerId] ?? { enabled: true, models: {} };
      if (Object.keys(currentPs.models).length === 0 && models.length) {
        const groups = groupByCapability(models);
        const seeded: Record<string, string> = {};
        for (const cap of adapter.capabilities) {
          if (groups[cap]?.length) seeded[cap] = groups[cap][0].id;
        }
        if (Object.keys(seeded).length) {
          await updateSettings({ providers: { ...settings.providers, [providerId]: { ...currentPs, models: seeded } } });
        }
      }
      toast.success(`${adapter.name}: ${result.message ?? "key valid"}`, {
        description: `${models.length} models loaded`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrors((e) => ({ ...e, [providerId]: msg }));
      toast.error(`${adapter.name} check failed`, { description: msg });
    } finally {
      setBusy((b) => ({ ...b, [providerId]: undefined }));
    }
  };

  const exportSettings = () => {
    const payload = {
      version: 1,
      app: "animai-studio",
      exportedAt: new Date().toISOString(),
      settings,
      note: "API keys are intentionally NOT included.",
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "animai-settings.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast.success("Settings exported (without API keys)");
  };

  const importSettings = async (file: File) => {
    try {
      const text = await file.text();
      const json = JSON.parse(text) as { settings?: typeof settings };
      if (!json.settings) throw new Error("Invalid settings file");
      await replaceSettings(json.settings);
      toast.success("Settings imported");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    }
  };

  const savePassphrase = async (value: string | null) => {
    try {
      await setPassphrase(value);
      toast.success(value ? "Passphrase set — keys re-encrypted" : "Passphrase removed — keys use a device key");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-5">
          <h1 className="text-xl font-bold tracking-tight">Providers & API keys</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Bring your own keys — they stay in this browser, encrypted with WebCrypto. They are never sent to our
            servers or logs; only the stateless CORS proxy sees them for the duration of each request.
          </p>
        </motion.div>

        <div className="mb-6 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={exportSettings}>
            <Download className="h-3.5 w-3.5" /> Export settings
          </Button>
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" /> Import settings
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importSettings(f);
              e.target.value = "";
            }}
          />
          <PassphraseButton hasKeys={hasAnyKeys} onSave={savePassphrase} />
          <div className="ml-auto flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-3 py-1 text-[11px] font-medium text-success">
            <ShieldCheck className="h-3.5 w-3.5" /> Browser-only storage
          </div>
        </div>

        <DefaultRoutingPanel settings={settings} updateSettings={updateSettings} />

        <div className="mb-4 grid gap-4 lg:grid-cols-2">
          {PROVIDERS.map((adapter) => (
            <ProviderCard
              key={adapter.id}
              adapter={adapter}
              settings={settings}
              keyRecord={keyRecords[adapter.id]}
              hasKey={Boolean(keys[adapter.id])}
              busy={busy[adapter.id]}
              error={errors[adapter.id]}
              models={modelCache[adapter.id]}
              onEnable={(v) => persistProvider(adapter.id, { enabled: v })}
              onBaseUrl={(url) => persistProvider(adapter.id, { customBaseUrl: url })}
              onSetModel={(cap, model) => setDefaultModel(adapter.id, cap, model)}
              onCheck={(key) => runValidateAndList(adapter.id, key)}
              onRefresh={() => runValidateAndList(adapter.id)}
              onSaveKey={async (key) => {
                await saveProviderKey(adapter.id, key);
                await runValidateAndList(adapter.id, key);
              }}
              onRemoveKey={() => {
                void removeProviderKey(adapter.id);
                setModelCache((c) => {
                  const next = { ...c };
                  delete next[adapter.id];
                  return next;
                });
                toast.success(`${adapter.name} key removed`);
              }}
            />
          ))}
        </div>

        <Separator className="my-8" />
        <p className="text-center text-xs text-muted-foreground">
          Free-tier tips: Groq, Google Gemini, OpenRouter (:free models), Hugging Face and NVIDIA NIM all offer free
          API keys — perfect for trying AnimAI Studio.
        </p>
      </div>
    </div>
  );
}

interface ProviderCardProps {
  adapter: ProviderAdapter;
  settings: ReturnType<typeof useWorkspace>["settings"];
  keyRecord?: { fingerprint: string; mode: string; updatedAt: number };
  hasKey: boolean;
  busy?: "validate" | "list";
  error?: string;
  models?: ModelCacheEntry;
  onEnable: (v: boolean) => void;
  onBaseUrl: (url: string) => void;
  onSetModel: (cap: Capability, model: string | null) => void;
  onCheck: (key?: string) => void;
  onRefresh: () => void;
  onSaveKey: (key: string) => Promise<void>;
  onRemoveKey: () => void;
}

function ProviderCard(props: ProviderCardProps) {
  const { adapter, settings, keyRecord, hasKey, busy, error, models } = props;
  const [keyInput, setKeyInput] = React.useState("");
  const [showKey, setShowKey] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const ps = settings.providers[adapter.id] ?? { enabled: true, models: {} };
  const loading = Boolean(busy);

  const groups = React.useMemo(() => (models ? groupByCapability(models.models) : null), [models]);
  const filtered = React.useMemo(() => {
    if (!groups) return null;
    const q = search.trim().toLowerCase();
    const out = {} as Record<Capability, ModelInfo[]>;
    for (const cap of CAPABILITIES) {
      out[cap] = (groups[cap] ?? []).filter((m) => !q || m.id.toLowerCase().includes(q) || (m.name ?? "").toLowerCase().includes(q));
    }
    return out;
  }, [groups, search]);

  const anyResults = filtered && CAPABILITIES.some((c) => filtered[c].length > 0);

  return (
    <motion.div layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <Card className={cn("h-full transition-opacity", !ps.enabled && "opacity-60")}>
        <CardHeader className="flex-row items-start justify-between space-y-0 gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-sm">
              <span className="truncate">{adapter.name}</span>
              {hasKey ? (
                <Badge variant="success">
                  <CheckCircle2 className="h-3 w-3" /> key saved
                </Badge>
              ) : (
                <Badge variant="outline">no key</Badge>
              )}
              {loading && (
                <Badge variant="info">
                  <Loader2 className="h-3 w-3 animate-spin" /> {busy === "validate" ? "testing" : "listing"}
                </Badge>
              )}
            </CardTitle>
            <p className="mt-1 truncate text-[11px] text-muted-foreground" title={adapter.tagline}>
              {adapter.tagline}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {adapter.capabilities.map((c) => (
                <Badge key={c} variant={ps.models[c] ? "default" : "secondary"}>
                  {CAP_LABEL[c]}
                  {ps.models[c] ? " ✓" : ""}
                </Badge>
              ))}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Switch checked={ps.enabled} onCheckedChange={props.onEnable} aria-label={`Enable ${adapter.name}`} />
            <a
              href={adapter.keyUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary"
            >
              get key <ExternalLink className="h-2.5 w-2.5" />
            </a>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {adapter.id === "custom" && (
            <div className="space-y-1.5">
              <Label htmlFor={`base-${adapter.id}`} className="text-xs">
                Base URL (OpenAI-compatible)
              </Label>
              <Input
                id={`base-${adapter.id}`}
                placeholder="https://api.example.com/v1"
                value={ps.customBaseUrl ?? ""}
                onChange={(e) => props.onBaseUrl(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor={`key-${adapter.id}`} className="text-xs">
                API key {keyRecord && <span className="text-muted-foreground">· fp {keyRecord.fingerprint}</span>}
              </Label>
              {hasKey && (
                <span className="text-[10px] text-muted-foreground">{formatDate(keyRecord?.updatedAt ?? 0)}</span>
              )}
            </div>
            <div className="flex gap-1.5">
              <div className="relative flex-1">
                <Input
                  id={`key-${adapter.id}`}
                  type={showKey ? "text" : "password"}
                  placeholder={hasKey ? "••••••••  (saved — paste to replace)" : adapter.keyHint}
                  value={keyInput}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setKeyInput(e.target.value)}
                  className="h-8 pr-8 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Toggle key visibility"
                >
                  {showKey ? <XCircle className="h-3.5 w-3.5" /> : <KeyRound className="h-3.5 w-3.5" />}
                </button>
              </div>
              <Button
                size="sm"
                className="h-8"
                disabled={loading || (!keyInput && !hasKey)}
                onClick={async () => {
                  if (keyInput) {
                    await props.onSaveKey(keyInput);
                    setKeyInput("");
                  } else {
                    props.onCheck();
                  }
                }}
              >
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : hasKey && !keyInput ? "Test" : "Save & test"}
              </Button>
              {hasKey && (
                <Button size="sm" variant="destructive" className="h-8 px-2" onClick={props.onRemoveKey} title="Remove key">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            {error && <p className="text-[11px] text-destructive">{error}</p>}
          </div>

          {models && (
            <div className="space-y-2 rounded-lg border border-border/70 bg-background/40 p-2.5">
              <div className="flex items-center gap-2">
                <Search className="h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder={`${models.models.length} models — search…`}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-7 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
                />
                <Button size="icon-sm" variant="ghost" className="h-6 w-6" onClick={props.onRefresh} title="Refresh models">
                  <Loader2 className={cn("h-3 w-3", loading && "animate-spin")} />
                </Button>
              </div>

              {loading && !anyResults && (
                <div className="space-y-1.5">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-5 w-1/2" />
                  <Skeleton className="h-5 w-3/5" />
                </div>
              )}

              {filtered &&
                CAPABILITIES.map((cap) =>
                  filtered[cap].length ? (
                    <div key={cap}>
                      <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {CAP_LABEL[cap]} · {filtered[cap].length}
                      </p>
                      <div className="max-h-40 space-y-0.5 overflow-y-auto scrollbar-thin pr-1">
                        {filtered[cap].slice(0, 60).map((m) => {
                          const selected = ps.models[cap] === m.id;
                          return (
                            <button
                              key={`${cap}-${m.id}`}
                              onClick={() => props.onSetModel(cap, selected ? null : m.id)}
                              className={cn(
                                "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-[11px] transition-colors",
                                selected ? "bg-primary/15 text-primary ring-1 ring-primary/40" : "hover:bg-accent/60"
                              )}
                              title={m.notes}
                            >
                              <span className="truncate font-mono">{m.id}</span>
                              {selected && <CheckCircle2 className="h-3 w-3 shrink-0" />}
                            </button>
                          );
                        })}
                        {filtered[cap].length > 60 && (
                          <p className="px-2 py-1 text-[10px] text-muted-foreground">+{filtered[cap].length - 60} more — refine search</p>
                        )}
                      </div>
                    </div>
                  ) : null
                )}

              {filtered && !anyResults && !loading && (
                <p className="py-2 text-center text-[11px] text-muted-foreground">No models match “{search}”</p>
              )}
            </div>
          )}

          {!models && !loading && (
            <p className="text-[11px] text-muted-foreground">
              Add a key to validate it and load the live model list, grouped by capability.
            </p>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function DefaultRoutingPanel({
  settings,
  updateSettings,
}: {
  settings: ReturnType<typeof useWorkspace>["settings"];
  updateSettings: ReturnType<typeof useWorkspace>["updateSettings"];
}) {
  const caps: Capability[] = ["text", "image", "video", "audio"];
  return (
    <div className="mb-4 rounded-2xl border border-border/70 bg-card/50 p-3.5">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold">Default routing</h2>
          <p className="text-[11px] text-muted-foreground">
            Pick which provider/model handles each capability. Falls back to the first enabled provider with a model.
          </p>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {caps.map((cap) => {
          const routes = availableRoutes(settings, cap);
          const current = settings.defaults?.[cap];
          const value = current ? `${current.providerId}::${current.model}` : "";
          return (
            <div key={cap} className="space-y-1">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{CAP_LABEL[cap]}</Label>
              <select
                value={value}
                disabled={routes.length === 0}
                onChange={(e) => {
                  const v = e.target.value;
                  const nextDefaults = { ...(settings.defaults ?? {}) };
                  if (!v) delete nextDefaults[cap];
                  else {
                    const [providerId, ...rest] = v.split("::");
                    nextDefaults[cap] = { providerId, model: rest.join("::") };
                  }
                  void updateSettings({ defaults: nextDefaults });
                }}
                className="h-8 w-full rounded-md border border-border bg-background/70 px-2 text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
              >
                <option value="">
                  {routes.length === 0 ? "no provider configured" : "auto (first available)"}
                </option>
                {routes.map((r) => (
                  <option key={`${r.providerId}::${r.model}`} value={`${r.providerId}::${r.model}`}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PassphraseButton({ hasKeys, onSave }: { hasKeys: boolean; onSave: (v: string | null) => Promise<void> }) {
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState("");
  const [mode, setMode] = React.useState<"set" | "remove">("set");

  if (!hasKeys) return null;

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <ShieldCheck className="h-3.5 w-3.5" /> Passphrase
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 anim-fade" onClick={() => setOpen(false)}>
          <Card className="w-full max-w-sm anim-rise" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <CardTitle className="text-sm">{mode === "set" ? "Set encryption passphrase" : "Remove passphrase"}</CardTitle>
              <p className="text-xs text-muted-foreground">
                {mode === "set"
                  ? "Re-encrypts all stored keys with PBKDF2 + AES-GCM. You'll need it after every reload."
                  : "Keys will be re-encrypted with a device-local random key instead."}
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {mode === "set" && (
                <Input
                  type="password"
                  placeholder="Passphrase"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="h-8 text-sm"
                  autoFocus
                />
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  disabled={mode === "set" && value.length < 4}
                  onClick={async () => {
                    await onSave(mode === "set" ? value : null);
                    setOpen(false);
                    setValue("");
                  }}
                >
                  {mode === "set" ? "Encrypt keys" : "Remove passphrase"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setMode(mode === "set" ? "remove" : "set")}>
                  {mode === "set" ? "Remove instead" : "Set instead"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}

export type { TabType };
