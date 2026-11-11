"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  ChevronDown,
  FolderOpen,
  MessageSquare,
  Plus,
  Play,
  Settings,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TAB_META, useWorkspace, type TabState, type TabType } from "./store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

const ICONS: Record<TabType, React.ComponentType<{ className?: string }>> = {
  chat: MessageSquare,
  settings: Settings,
  files: FolderOpen,
  viewer: Play,
};

export function TabBar() {
  const { tabs, activeTabId, openTab, closeTab, moveTab, setActiveTab } = useWorkspace();
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);
  const [overIndex, setOverIndex] = React.useState<number | null>(null);

  const onDrop = () => {
    if (dragIndex !== null && overIndex !== null && dragIndex !== overIndex) {
      moveTab(dragIndex, overIndex);
    }
    setDragIndex(null);
    setOverIndex(null);
  };

  return (
    <div className="flex items-center gap-1 overflow-x-auto scrollbar-thin px-2 py-1.5">
      {tabs.map((tab, i) => (
        <TabPill
          key={tab.id}
          tab={tab}
          index={i}
          active={tab.id === activeTabId}
          dragging={dragIndex === i}
          over={overIndex === i}
          onActivate={() => setActiveTab(tab.id)}
          onClose={() => closeTab(tab.id)}
          onDragStart={() => setDragIndex(i)}
          onDragOver={(e) => {
            e.preventDefault();
            setOverIndex(i);
          }}
          onDrop={onDrop}
          onDragEnd={() => {
            setDragIndex(null);
            setOverIndex(null);
          }}
        />
      ))}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="ml-1 shrink-0" aria-label="New tab" title="New tab (Ctrl+Shift+N)">
            <Plus className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>New tab</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {(Object.keys(TAB_META) as TabType[]).map((type) => (
            <DropdownMenuItem key={type} onClick={() => openTab(type)}>
              {React.createElement(ICONS[type], { className: "h-4 w-4" })}
              {TAB_META[type].title}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

interface TabPillProps {
  tab: TabState;
  index: number;
  active: boolean;
  dragging: boolean;
  over: boolean;
  onActivate: () => void;
  onClose: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  onDragEnd: () => void;
}

function TabPill({ tab, active, dragging, over, onActivate, onClose, onDragStart, onDragOver, onDrop, onDragEnd }: TabPillProps) {
  const Icon = ICONS[tab.type];
  const closable = true;
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onClick={onActivate}
      role="tab"
      aria-selected={active}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate();
        }
      }}
      className={cn(
        "group relative flex h-8 shrink-0 cursor-grab items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-all select-none",
        active
          ? "glass text-foreground shadow-md shadow-primary/10"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
        dragging && "opacity-40",
        over && !dragging && "ring-1 ring-primary/60"
      )}
      title="Drag to reorder"
    >
      <Icon className={cn("h-3.5 w-3.5", active && "text-primary")} />
      <span className="max-w-[120px] truncate">{tab.title}</span>
      {closable && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          aria-label={`Close ${tab.title}`}
          className="ml-0.5 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-70 hover:!opacity-100 hover:bg-background/60"
        >
          <X className="h-3 w-3" />
        </button>
      )}
      {active && (
        <motion.span
          layoutId="tab-underline"
          className="absolute inset-x-2 -bottom-0.5 h-0.5 rounded-full bg-gradient-to-r from-primary to-cyan-400"
        />
      )}
    </div>
  );
}

export function TabHint() {
  return (
    <span className="hidden items-center gap-1.5 text-[11px] text-muted-foreground lg:flex">
      <kbd className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px]">Ctrl</kbd>
      <span>+</span>
      <kbd className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px]">1–4</kbd>
      <span className="ml-1">switch tabs</span>
      <ChevronDown className="h-3 w-3 opacity-40" />
    </span>
  );
}
