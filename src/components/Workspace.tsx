import { useEffect, useState } from "react";
import { useWorkspaceStore, Pane } from "../store/workspaceStore";
import { Sidebar } from "./Sidebar";
import { TerminalPane } from "./TerminalPane";
import { SettingsDialog } from "./SettingsDialog";
import { CommandPalette } from "./CommandPalette";
import {
  Plus,
  X,
  Terminal,
  Command,
  Cpu,
  GripVertical,
  Settings,
  Folder,
} from "lucide-react";

function shellBadge(shell: string) {
  const s = shell.toLowerCase();
  if (s.includes("fish"))
    return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (s.includes("zsh"))
    return "bg-violet-500/15 text-violet-300 border-violet-500/30";
  if (s.includes("bash"))
    return "bg-lime-500/15 text-lime-300 border-lime-500/30";
  if (s.includes("nu"))
    return "bg-teal-500/15 text-teal-300 border-teal-500/30";
  if (s.includes("pwsh") || s.includes("powershell"))
    return "bg-sky-500/15 text-sky-300 border-sky-500/30";
  return "bg-slate-500/15 text-slate-300 border-slate-500/30";
}

function baseName(path: string) {
  return (
    path
      .split(/[\/\\]/)
      .filter(Boolean)
      .pop() ?? path
  );
}

function getGridLayout(count: number) {
  if (count <= 1) return { cols: 1, rows: 1 };
  if (count <= 2) return { cols: 1, rows: 2 };
  if (count <= 4) return { cols: 2, rows: 2 };
  const cols = 3;
  return { cols, rows: Math.ceil(count / cols) };
}

const PANE_COLOR_PALETTE: (string | undefined)[] = [
  undefined,
  "#22d3ee",
  "#34d399",
  "#facc15",
  "#f87171",
  "#c084fc",
  "#60a5fa",
  "#fb923c",
];

export function Workspace() {
  const store = useWorkspaceStore();
  const workspace = store.getActiveWorkspace();
  const panes = workspace?.panes.filter((p) => !p.overlay) ?? [];
  const overlayPanes = workspace?.panes.filter((p) => p.overlay) ?? [];
  const count = panes.length;
  const activeTerminalId = workspace?.activeTerminalId ?? null;

  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [editingPaneId, setEditingPaneId] = useState<string | null>(null);
  const [editingPaneName, setEditingPaneName] = useState("");

  useEffect(() => {
    const cyclePane = (dir: number) => {
      const ws = useWorkspaceStore.getState().getActiveWorkspace();
      if (!ws) return;
      const gridPanes = ws.panes.filter((p) => !p.overlay && p.sessionId);
      if (gridPanes.length === 0) return;
      const idx = gridPanes.findIndex((p) => p.sessionId === ws.activeTerminalId);
      const next = gridPanes[(idx + dir + gridPanes.length) % gridPanes.length];
      if (next.sessionId) useWorkspaceStore.getState().setActiveTerminal(next.sessionId);
    };

    const cycleWorkspace = (dir: number) => {
      const s = useWorkspaceStore.getState();
      const list = s.workspaces;
      if (list.length === 0) return;
      const idx = list.findIndex((w) => w.id === (s.activeWorkspaceId ?? list[0].id));
      const next = list[(idx + dir + list.length) % list.length];
      s.setActiveWorkspace(next.id);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const ctrlOrCmd = e.ctrlKey || e.metaKey;
      if (!ctrlOrCmd) return;

      if (e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        useWorkspaceStore.getState().addPane();
        return;
      }
      if (!e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowPalette(true);
        return;
      }
      if (e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        useWorkspaceStore.getState().reopenLastPane();
        return;
      }
      if (e.shiftKey && (e.key === "]" || e.key === "}")) {
        e.preventDefault();
        cycleWorkspace(1);
        return;
      }
      if (e.shiftKey && (e.key === "[" || e.key === "{")) {
        e.preventDefault();
        cycleWorkspace(-1);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        cyclePane(e.shiftKey ? -1 : 1);
        return;
      }
      if (!e.shiftKey && /^[1-9]$/.test(e.key)) {
        const ws = useWorkspaceStore.getState().getActiveWorkspace();
        const gridPanes = ws?.panes.filter((p) => !p.overlay) ?? [];
        const target = gridPanes[Number(e.key) - 1];
        if (target?.sessionId) {
          e.preventDefault();
          useWorkspaceStore.getState().setActiveTerminal(target.sessionId);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const { cols, rows } = getGridLayout(count);
  const allCount = store.workspaces.length;
  const label = workspace ? workspace.name : "Workspace";

  const activeIndex = panes.findIndex((p) => p.sessionId === activeTerminalId);
  const activeNumber = activeIndex >= 0 ? activeIndex + 1 : 0;

  const startRenamePane = (pane: Pane, index: number) => {
    setEditingPaneId(pane.id);
    setEditingPaneName(pane.title ?? `Terminal ${index + 1}`);
  };

  const commitRenamePane = () => {
    const name = editingPaneName.trim();
    if (editingPaneId) store.renamePane(editingPaneId, name || undefined);
    setEditingPaneId(null);
  };

  const cyclePaneColor = (pane: Pane) => {
    const idx = PANE_COLOR_PALETTE.indexOf(pane.color);
    const next = PANE_COLOR_PALETTE[(idx + 1 + PANE_COLOR_PALETTE.length) % PANE_COLOR_PALETTE.length];
    store.setPaneColor(pane.id, next);
  };

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-[#05070a] text-slate-100 selection:bg-accent/30 font-sans antialiased">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0 relative">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_color-mix(in_srgb,var(--color-accent)_35%,#05070a)_0%,_#05070a_60%)] opacity-60 pointer-events-none" />
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_bottom_right,_color-mix(in_srgb,var(--color-accent-2)_35%,#05070a)_0%,_transparent_55%)] opacity-40 pointer-events-none" />

        <header className="h-14 shrink-0 px-5 flex items-center justify-between bg-slate-950/60 backdrop-blur-xl border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-accent to-accent-2 shadow-lg shadow-accent/20 ring-1 ring-white/20">
              <Cpu size={18} className="text-white" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-bold tracking-tight bg-gradient-to-r from-accent to-accent-2 bg-clip-text text-transparent">
                {label}
              </span>
              <span className="text-[10px] text-slate-400 mt-0.5">
                {count} terminal{count === 1 ? "" : "s"} · {allCount} workspace
                {allCount === 1 ? "" : "s"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowPalette(true)}
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-700/80 border border-white/10 hover:border-accent/40 transition-all text-xs font-medium text-slate-400 hover:text-slate-200"
              title="Command palette"
            >
              <Command size={13} />
              <span>Commands</span>
              <kbd className="text-[10px] font-mono text-slate-500 bg-slate-900/80 px-1.5 py-0.5 rounded border border-white/5">
                ⌘K
              </kbd>
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 rounded-lg text-slate-400 hover:text-accent hover:bg-slate-800/60 border border-transparent hover:border-white/10 transition-all"
              title="Settings"
            >
              <Settings size={15} />
            </button>
            <button
              onClick={() => store.addPane()}
              className="group flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-white/10 hover:border-accent/40 transition-all hover:shadow-[0_0_20px_color-mix(in_srgb,var(--color-accent)_15%,transparent)] text-xs font-medium"
            >
              <Plus
                size={14}
                className="text-slate-400 group-hover:text-accent transition-colors"
              />
              <span>New Terminal</span>
              <kbd className="hidden sm:inline-flex items-center gap-1 text-[10px] font-mono text-slate-500 bg-slate-900/80 px-1.5 py-0.5 rounded border border-white/5 group-hover:border-accent/20 group-hover:text-slate-400 transition-colors">
                <Command size={10} />
                <span>+</span>
                <span>Shift</span>
                <span>+ T</span>
              </kbd>
            </button>
          </div>
        </header>

        <main
          className="flex-1 min-w-0 overflow-auto grid gap-3 p-3"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
          }}
        >
          {panes.map((pane, index) => {
            const isActive = pane.sessionId === activeTerminalId;
            const isDragging = dragId === pane.id;
            const isDropTarget = dropTargetId === pane.id && !isDragging;
            const isEditing = editingPaneId === pane.id;
            const displayTitle = pane.title ?? `Terminal ${index + 1}`;
            return (
              <div
                key={pane.id}
                onDragOver={(e) => {
                  if (!dragId || dragId === pane.id) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDropTargetId(pane.id);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setDropTargetId(null);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const src = e.dataTransfer.getData("application/x-pane-id");
                  if (src && src !== pane.id) store.swapPanes(src, pane.id);
                  setDragId(null);
                  setDropTargetId(null);
                }}
                className={`terminal-card group min-h-0 h-full w-full flex flex-col rounded-2xl border backdrop-blur-sm overflow-hidden transition-all duration-300 ${
                  isDropTarget
                    ? "border-accent/60 shadow-[0_0_30px_color-mix(in_srgb,var(--color-accent)_20%,transparent)] bg-slate-900/70"
                    : isActive
                      ? "border-accent/40 bg-slate-900/70 shadow-2xl shadow-accent/10 shadow-black/40"
                      : "border-white/10 bg-slate-900/60 shadow-2xl shadow-black/40 hover:border-accent/20 hover:shadow-[0_0_30px_color-mix(in_srgb,var(--color-accent)_8%,transparent)]"
                } ${isDragging ? "opacity-40 scale-[0.99]" : ""}`}
              >
                <div
                  draggable={count > 1 && !isEditing}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/x-pane-id", pane.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDragId(pane.id);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setDropTargetId(null);
                  }}
                  className={`h-10 shrink-0 flex items-center justify-between px-3 border-b transition-colors ${
                    isActive
                      ? "bg-slate-900/90 border-accent/20"
                      : "bg-slate-900/80 border-white/10"
                  } ${count > 1 ? "cursor-grab active:cursor-grabbing" : ""}`}
                  title={count > 1 ? "Drag to rearrange" : undefined}
                >
                  <div className="flex items-center gap-2 text-xs font-medium text-slate-300 min-w-0">
                    {count > 1 && (
                      <GripVertical
                        size={12}
                        className="shrink-0 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity"
                      />
                    )}
                    <button
                      onClick={() => cyclePaneColor(pane)}
                      className="shrink-0 w-2.5 h-2.5 rounded-full border border-white/20 transition-transform hover:scale-125"
                      style={{ backgroundColor: pane.color ?? "transparent" }}
                      title="Click to cycle tag color"
                    />
                    <Terminal
                      size={13}
                      className={isActive ? "text-accent" : "text-slate-500"}
                    />
                    {isEditing ? (
                      <input
                        autoFocus
                        value={editingPaneName}
                        onChange={(e) => setEditingPaneName(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onFocus={(e) => e.target.select()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRenamePane();
                          if (e.key === "Escape") setEditingPaneId(null);
                        }}
                        onBlur={commitRenamePane}
                        className="min-w-0 w-24 bg-slate-900/80 border border-accent/40 rounded px-1 py-0.5 text-xs text-accent outline-none"
                      />
                    ) : (
                      <span
                        className="truncate"
                        onDoubleClick={() => startRenamePane(pane, index)}
                        title="Double-click to rename"
                      >
                        {displayTitle}
                      </span>
                    )}
                    {pane.shell && (
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-mono font-medium border ${shellBadge(pane.shell)}`}
                        title={`Shell: ${pane.shell}`}
                      >
                        {pane.shell}
                      </span>
                    )}
                    {pane.cwd && (
                      <span
                        className="hidden md:inline-flex items-center gap-1 text-[10px] text-slate-500 font-mono max-w-[160px] min-w-0"
                        title={pane.cwd}
                      >
                        <Folder size={10} className="shrink-0" />
                        <span className="truncate">{baseName(pane.cwd)}</span>
                      </span>
                    )}
                    {isActive && (
                      <span className="ml-1 inline-flex items-center gap-1.5 pl-1.5 pr-2 py-0.5 rounded-full bg-accent/10 border border-accent/20 text-[10px] text-accent">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent shadow-[0_0_8px_color-mix(in_srgb,var(--color-accent)_60%,transparent)] animate-pulse-soft" />
                        Active
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => store.removePane(pane.id)}
                    className="p-1.5 rounded-md text-slate-500 hover:bg-rose-500/20 hover:text-rose-300 transition-colors"
                    title="Close terminal"
                  >
                    <X size={13} />
                  </button>
                </div>
                <div
                  className={`flex-1 min-h-0 relative bg-[#080c14] transition-opacity ${
                    isActive ? "opacity-100" : "opacity-90"
                  }`}
                >
                  <TerminalPane paneId={pane.id} />
                </div>
              </div>
            );
          })}
        </main>

        {overlayPanes.map((pane) => (
          <div
            key={pane.id}
            className="absolute inset-0 z-20 p-3 bg-black/70 backdrop-blur-sm animate-fade-in"
          >
            <div className="h-full w-full flex flex-col rounded-2xl border border-white/15 bg-slate-900/80 shadow-2xl shadow-black/60 overflow-hidden animate-slide-up ring-1 ring-accent/10">
              <div className="h-10 shrink-0 flex items-center justify-between px-4 bg-slate-900/80 border-b border-white/10">
                <div className="flex items-center gap-2 min-w-0 text-xs font-medium text-slate-300">
                  <Terminal size={13} className="shrink-0 text-accent" />
                  <span className="truncate">{pane.title ?? "Terminal"}</span>
                  {pane.shell && (
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-mono font-medium border ${shellBadge(pane.shell)}`}
                      title={`Shell: ${pane.shell}`}
                    >
                      {pane.shell}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => store.removePane(pane.id)}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md text-slate-500 hover:bg-rose-500/20 hover:text-rose-300 transition-colors"
                  title="Close"
                >
                  <X size={13} />
                  <span className="text-[10px]">Close</span>
                </button>
              </div>
              <div className="flex-1 min-h-0 relative bg-[#080c14]">
                <TerminalPane paneId={pane.id} />
              </div>
            </div>
          </div>
        ))}

        {showSettings && (
          <SettingsDialog onClose={() => setShowSettings(false)} />
        )}

        {showPalette && (
          <CommandPalette
            onClose={() => setShowPalette(false)}
            onOpenSettings={() => setShowSettings(true)}
          />
        )}

        <footer className="h-7 shrink-0 px-5 flex items-center justify-between text-[11px] text-slate-500 bg-slate-950/60 backdrop-blur border-t border-white/10">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
            PTY engine ready
            {activeNumber > 0 && (
              <span className="ml-2 inline-flex items-center gap-1.5 text-slate-400">
                <Terminal size={12} className="text-accent" />
                Terminal {activeNumber} active
              </span>
            )}
          </span>
          <span className="hidden sm:inline-flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 rounded bg-slate-900/80 border border-white/10 font-mono text-[10px]">
              ⌃/⌘ K
            </kbd>
            <span className="text-slate-600">commands</span>
            <span className="text-slate-700 mx-1">·</span>
            <kbd className="px-1.5 py-0.5 rounded bg-slate-900/80 border border-white/10 font-mono text-[10px]">
              ⌃/⌘ ⇧ T
            </kbd>
            <span className="text-slate-600">new terminal</span>
            <span className="text-slate-700 mx-1">·</span>
            <span className="text-slate-600">drag headers to rearrange</span>
          </span>
        </footer>
      </div>
    </div>
  );
}
