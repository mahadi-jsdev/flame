import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useWorkspaceStore, Pane, panesForProject } from "../store/workspaceStore";
import { Sidebar } from "./Sidebar";
import { TitleBar } from "./TitleBar";
import { TerminalPane } from "./TerminalPane";
import { SettingsDialog } from "./SettingsDialog";
import { CommandPalette } from "./CommandPalette";
import { GitPanel } from "./GitPanel";
import { FileFinder, type OpenedFileInfo } from "./FileFinder";
import { FileEditorDialog } from "./FileEditorDialog";
import {
  Plus,
  X,
  Command,
  Flame,
  GripVertical,
  Settings,
  Folder,
  Search,
  PanelLeftOpen,
  PanelRightOpen,
  Minimize2,
  Maximize2,
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

const WAITING_COLOR = "#fb7185";

function paneStatusDotClass(pane: Pane) {
  if (pane.waitingForInput) return "bg-[#fb7185] animate-pulse-soft";
  if (pane.running) return "bg-accent animate-pulse-soft";
  return "bg-[#6f6455]";
}

function paneStatusGlow(pane: Pane): CSSProperties | undefined {
  if (pane.waitingForInput) return { boxShadow: `0 0 6px 1px ${WAITING_COLOR}` };
  if (pane.running) return { boxShadow: "0 0 6px 1px var(--color-accent)" };
  return undefined;
}

// Counts 2-4 get a hand-placed layout (2: side by side; 3: two on top, one
// spanning the full bottom row; 4: that bottom row splits in half too) with
// a real draggable gutter track between cells. 5+ falls back to a plain
// wrapping grid. Every pane div stays a flat, constant-depth child of
// <main> across all of this — only its own gridColumn/gridRow placement
// changes — so a pane's React identity (and thus its PTY) is never
// disturbed by adding, removing, or resizing panes.
const GUTTER = 6; // px

function hasDraggableLayout(count: number) {
  return count >= 2 && count <= 4;
}

function getGridTemplate(count: number, colSplit: number, rowSplit: number) {
  if (count === 2) {
    return {
      gridTemplateColumns: `minmax(0,${colSplit}fr) ${GUTTER}px minmax(0,${1 - colSplit}fr)`,
      gridTemplateRows: "minmax(0,1fr)",
    };
  }
  if (hasDraggableLayout(count)) {
    return {
      gridTemplateColumns: `minmax(0,${colSplit}fr) ${GUTTER}px minmax(0,${1 - colSplit}fr)`,
      gridTemplateRows: `minmax(0,${rowSplit}fr) ${GUTTER}px minmax(0,${1 - rowSplit}fr)`,
    };
  }
  const cols = count <= 1 ? 1 : 3;
  return {
    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${Math.max(1, Math.ceil(count / cols))}, minmax(0, 1fr))`,
  };
}

function panePlacement(index: number, count: number): CSSProperties {
  if (count === 2) {
    return index === 0 ? { gridColumn: "1", gridRow: "1" } : { gridColumn: "3", gridRow: "1" };
  }
  if (count === 3) {
    if (index === 0) return { gridColumn: "1", gridRow: "1" };
    if (index === 1) return { gridColumn: "3", gridRow: "1" };
    return { gridColumn: "1 / 4", gridRow: "3" };
  }
  if (count === 4) {
    return {
      gridColumn: index % 2 === 0 ? "1" : "3",
      gridRow: index < 2 ? "1" : "3",
    };
  }
  return {};
}

function formatUptime(totalSeconds: number) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

const PANE_COLOR_PALETTE: (string | undefined)[] = [
  undefined,
  "#ffb238",
  "#8fcf8a",
  "#ffcb6b",
  "#ff6b52",
  "#c9a877",
  "#8bb4e8",
  "#e0894a",
];

export function Workspace() {
  const store = useWorkspaceStore();
  const workspace = store.getActiveWorkspace();
  const project = workspace?.projects.find((p) => p.id === workspace.activeProjectId);
  const projectPanes = workspace ? panesForProject(workspace, workspace.activeProjectId) : [];
  const panes = projectPanes.filter((p) => !p.backgrounded);
  const backgroundedPanes = projectPanes.filter((p) => p.backgrounded);
  const overlayPanes = workspace?.panes.filter((p) => p.overlay) ?? [];
  const count = panes.length;
  const activeTerminalId = workspace?.activeTerminalId ?? null;
  const liveCount = projectPanes.filter((p) => p.running).length;
  const visibleIds = new Set(panes.map((p) => p.id));

  // Every non-overlay pane across every workspace stays mounted here — only
  // visibility (via a CSS class, never conditional inclusion) changes when
  // you switch workspace or project. Unmounting would kill its PTY and lose
  // scrollback, which defeats the point of "keep running in the background."
  const allPanes = store.workspaces.flatMap((w) =>
    w.panes.filter((p) => !p.overlay),
  );

  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showFileFinder, setShowFileFinder] = useState(false);
  const [openedFile, setOpenedFile] = useState<OpenedFileInfo | null>(null);
  const [editingPaneId, setEditingPaneId] = useState<string | null>(null);
  const [editingPaneName, setEditingPaneName] = useState("");
  const [uptimeSec, setUptimeSec] = useState(0);
  const [colSplit, setColSplit] = useState(0.5);
  const [rowSplit, setRowSplit] = useState(0.5);
  const mainRef = useRef<HTMLDivElement>(null);
  // Every pane stays mounted forever (see allPanes above) and only toggles
  // the `hidden` class when switching projects/workspaces. A CSS @keyframes
  // animation replays from 0% any time an element goes display:none -> block,
  // so applying the pop-in animation unconditionally on .terminal-card would
  // replay it on every project switch. Instead, play it once per pane's true
  // first appearance and drop the class for good once that animation
  // actually finishes (onAnimationEnd, not a timer, so it's never cut short).
  const [settledPaneIds, setSettledPaneIds] = useState<Set<string>>(new Set());
  const settlePane = (id: string) => {
    setSettledPaneIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  };

  const startColDrag = (e: ReactPointerEvent) => {
    e.preventDefault();
    const rect = mainRef.current?.getBoundingClientRect();
    if (!rect) return;
    const onMove = (ev: PointerEvent) => {
      setColSplit(Math.min(0.85, Math.max(0.15, (ev.clientX - rect.left) / rect.width)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const startRowDrag = (e: ReactPointerEvent) => {
    e.preventDefault();
    const rect = mainRef.current?.getBoundingClientRect();
    if (!rect) return;
    const onMove = (ev: PointerEvent) => {
      setRowSplit(Math.min(0.85, Math.max(0.15, (ev.clientY - rect.top) / rect.height)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setUptimeSec(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const cyclePane = (dir: number) => {
      const ws = useWorkspaceStore.getState().getActiveWorkspace();
      if (!ws) return;
      const gridPanes = panesForProject(ws, ws.activeProjectId).filter(
        (p) => p.sessionId && !p.backgrounded,
      );
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
      if (!e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        const ws = useWorkspaceStore.getState().getActiveWorkspace();
        const proj = ws?.projects.find((p) => p.id === ws.activeProjectId);
        if (proj) setShowFileFinder(true);
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
        const gridPanes = ws
          ? panesForProject(ws, ws.activeProjectId).filter((p) => !p.backgrounded)
          : [];
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

  const gridTemplate = getGridTemplate(count, colSplit, rowSplit);
  const draggable = hasDraggableLayout(count);
  const label = workspace ? workspace.name : "Workspace";

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
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-[#0e0b08] text-[#f3e9d8] selection:bg-accent/30 antialiased">
      <TitleBar />
      <div className="flex-1 min-h-0 flex overflow-hidden">
      {store.settings.sidebarCollapsed ? (
        <div className="w-10 h-full shrink-0 flex flex-col items-center pt-3 gap-3 bg-[#1d1811] border-r border-white/10">
          <button
            onClick={() => store.updateSettings({ sidebarCollapsed: false })}
            className="p-1.5 rounded-md text-[#a99a86] hover:text-accent hover:bg-white/[0.06] transition-colors"
            title="Expand sidebar"
          >
            <PanelLeftOpen size={16} />
          </button>
        </div>
      ) : (
        <Sidebar />
      )}

      <div className="flex-1 flex flex-col min-w-0 relative">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_color-mix(in_srgb,var(--color-accent)_18%,#0e0b08)_0%,_#0e0b08_60%)] opacity-70 pointer-events-none" />
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_bottom_right,_color-mix(in_srgb,var(--color-accent-2)_18%,#0e0b08)_0%,_transparent_55%)] opacity-50 pointer-events-none" />
        <div
          className="absolute inset-0 -z-10 opacity-[0.05] pointer-events-none"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, rgba(244,225,190,.4) 0 1px, transparent 1px 28px), repeating-linear-gradient(90deg, rgba(244,225,190,.4) 0 1px, transparent 1px 28px)",
          }}
        />

        <header className="h-14 shrink-0 px-5 flex items-center justify-between border-b border-white/10">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-xl bg-gradient-to-br from-accent to-accent-2 ring-1 ring-white/10 shrink-0">
              <Flame size={18} className="text-[#1a1006]" />
            </div>
            <div className="flex items-baseline gap-2 min-w-0 text-sm">
              <span className="font-display font-semibold tracking-wide text-[#f3e9d8] truncate">
                {label}
              </span>
              <span className="text-[#6f6455] shrink-0">/</span>
              <span className="text-[11px] font-mono text-[#a99a86] truncate">
                {count} bay{count === 1 ? "" : "s"} · {liveCount} live · uptime{" "}
                <span className="tabular-nums">{formatUptime(uptimeSec)}</span>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowPalette(true)}
              className="hidden sm:flex items-center gap-3 w-64 px-3 py-1.5 rounded-lg bg-black/30 border border-white/10 hover:border-white/20 transition-colors text-left"
              title="Command palette"
            >
              <Search size={13} className="text-[#6f6455] shrink-0" />
              <span className="flex-1 text-[12.5px] text-[#8a7c68] truncate">
                Search or run a command
              </span>
              <kbd className="text-[10px] font-mono text-[#6f6455] bg-black/40 px-1.5 py-0.5 rounded border border-white/10 shrink-0">
                ⌘K
              </kbd>
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 rounded-lg text-[#a99a86] hover:text-accent hover:bg-white/[0.05] border border-transparent hover:border-white/10 transition-colors"
              title="Settings"
            >
              <Settings size={15} />
            </button>
            <button
              onClick={() => store.addPane()}
              className="group flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent border border-accent hover:bg-[#ffbe57] hover:border-[#ffbe57] transition-colors text-xs font-semibold text-[#1a1006]"
            >
              <Plus size={14} />
              <span>New Bay</span>
              <kbd className="hidden sm:inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border border-[#1a1006]/25 text-[#1a1006]/70">
                <Command size={10} />
                <span>+</span>
                <span>Shift</span>
                <span>+ T</span>
              </kbd>
            </button>
          </div>
        </header>

        {backgroundedPanes.length > 0 && (
          <div className="shrink-0 flex items-center gap-2 px-5 py-2 border-b border-white/10 overflow-x-auto">
            <span className="shrink-0 text-[10px] font-display font-semibold text-[#6f6455] uppercase tracking-widest">
              Background
            </span>
            {backgroundedPanes.map((pane) => {
              const num = projectPanes.findIndex((p) => p.id === pane.id) + 1;
              return (
                <button
                  key={pane.id}
                  onClick={() => store.setPaneBackgrounded(pane.id, false)}
                  className="group shrink-0 flex items-center gap-1.5 pl-2.5 pr-2 py-1 rounded-full bg-white/[0.04] border border-white/10 hover:border-accent/40 hover:bg-white/[0.06] transition-colors"
                  title="Bring to foreground"
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${paneStatusDotClass(pane)}`} />
                  <span
                    className="text-[11px] font-mono truncate max-w-[120px]"
                    style={{ color: pane.color ?? "#d9cbb5" }}
                  >
                    {pane.title ?? `Terminal ${num}`}
                  </span>
                  <Maximize2
                    size={11}
                    className="text-[#6f6455] group-hover:text-accent transition-colors"
                  />
                </button>
              );
            })}
          </div>
        )}

        <div className="flex-1 min-h-0 flex gap-3 p-3 overflow-hidden">
          <main
            ref={mainRef}
            className={`flex-1 min-w-0 overflow-auto grid ${draggable ? "" : "gap-3"}`}
            style={gridTemplate}
          >
            {allPanes.map((pane) => {
              const isVisible = visibleIds.has(pane.id);
              // Grid placement needs the pane's position among only the
              // currently-visible panes; the display number stays stable
              // (based on the full project set) so it doesn't jump around
              // as panes are sent to/from the background.
              const index = panes.findIndex((p) => p.id === pane.id);
              const stableNumber = projectPanes.findIndex((p) => p.id === pane.id);
              const isActive = pane.sessionId === activeTerminalId;
              const isDragging = dragId === pane.id;
              const isDropTarget = dropTargetId === pane.id && !isDragging;
              const isEditing = editingPaneId === pane.id;
              const displayTitle = pane.title ?? `Terminal ${stableNumber + 1}`;
              return (
                <div
                  key={pane.id}
                  onDragOver={(e) => {
                    if (!isVisible || !dragId || dragId === pane.id) return;
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
                    if (!isVisible) return;
                    e.preventDefault();
                    const src = e.dataTransfer.getData("application/x-pane-id");
                    if (src && src !== pane.id) store.swapPanes(src, pane.id);
                    setDragId(null);
                    setDropTargetId(null);
                  }}
                  style={panePlacement(index, count)}
                  onAnimationEnd={() => settlePane(pane.id)}
                  className={`terminal-card group min-h-0 h-full w-full flex flex-col rounded-2xl border overflow-hidden transition-colors duration-200 bg-[#1d1811]/70 ${
                    settledPaneIds.has(pane.id) ? "" : "animate-pop-in"
                  } ${
                    !isVisible
                      ? "hidden"
                      : isDropTarget
                        ? "border-accent/60"
                        : isActive
                          ? "border-accent/40"
                          : "border-white/10 hover:border-white/20"
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
                    className={`h-10 shrink-0 flex items-center gap-2 px-3 border-b transition-colors ${
                      isActive ? "border-white/10 bg-white/[0.02]" : "border-white/10"
                    } ${count > 1 ? "cursor-grab active:cursor-grabbing" : ""}`}
                    title={count > 1 ? "Drag to rearrange" : undefined}
                  >
                    <div className="flex-1 flex items-center gap-2 text-xs font-medium min-w-0">
                      {count > 1 && (
                        <GripVertical
                          size={12}
                          className="shrink-0 text-[#6f6455] opacity-0 group-hover:opacity-100 transition-opacity"
                        />
                      )}
                      <span
                        className={`shrink-0 w-1.5 h-1.5 rounded-full ${paneStatusDotClass(pane)}`}
                        style={paneStatusGlow(pane)}
                      />
                      <button
                        onClick={() => cyclePaneColor(pane)}
                        className="shrink-0 w-2 h-2 rounded-sm border border-white/20 transition-transform hover:scale-125"
                        style={{ backgroundColor: pane.color ?? "transparent" }}
                        title="Click to cycle tag color"
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
                          className="min-w-0 w-24 bg-black/30 border border-accent/40 rounded px-1 py-0.5 font-mono text-xs text-accent outline-none"
                        />
                      ) : (
                        <span
                          className="font-mono font-semibold truncate"
                          style={{ color: pane.color ?? "#f3e9d8" }}
                          onDoubleClick={() => startRenamePane(pane, stableNumber)}
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
                          className="hidden md:inline-flex items-center gap-1 text-[10px] text-[#6f6455] font-mono max-w-[160px] min-w-0"
                          title={pane.cwd}
                        >
                          <Folder size={10} className="shrink-0" />
                          <span className="truncate">{baseName(pane.cwd)}</span>
                        </span>
                      )}
                    </div>
                    {pane.sessionId && (
                      <span
                        className={`shrink-0 text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
                          pane.waitingForInput
                            ? "bg-[#fb7185]/15 text-[#fb7185]"
                            : pane.running
                              ? "bg-accent/15 text-accent"
                              : "bg-white/[0.04] text-[#6f6455]"
                        }`}
                      >
                        {pane.waitingForInput ? "waiting" : pane.running ? "running" : "idle"}
                      </span>
                    )}
                    <button
                      onClick={() => store.setPaneBackgrounded(pane.id, true)}
                      className="p-1.5 rounded-md text-[#6f6455] hover:bg-white/[0.06] hover:text-accent transition-colors shrink-0"
                      title="Send to background"
                    >
                      <Minimize2 size={12} />
                    </button>
                    <button
                      onClick={() => store.removePane(pane.id)}
                      className="p-1.5 rounded-md text-[#6f6455] hover:bg-rose-500/20 hover:text-rose-300 transition-colors shrink-0"
                      title="Close terminal"
                    >
                      <X size={13} />
                    </button>
                  </div>
                  <div className="flex-1 min-h-0 relative bg-[#0e0b08] overflow-hidden">
                    <TerminalPane paneId={pane.id} visible={isVisible} />
                  </div>
                </div>
              );
            })}

            {draggable && (
              <div
                onPointerDown={startColDrag}
                style={{ gridColumn: "2", gridRow: count === 4 ? "1 / 4" : "1" }}
                className="group/handle relative z-10 cursor-col-resize"
              >
                <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/10 transition-colors group-hover/handle:bg-accent/60 group-active/handle:bg-accent" />
              </div>
            )}
            {draggable && count >= 3 && (
              <div
                onPointerDown={startRowDrag}
                style={{ gridColumn: "1 / 4", gridRow: "2" }}
                className="group/handle relative z-10 cursor-row-resize"
              >
                <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/10 transition-colors group-hover/handle:bg-accent/60 group-active/handle:bg-accent" />
              </div>
            )}
          </main>

          {store.settings.gitPanelCollapsed ? (
            <div className="w-10 h-full shrink-0 flex flex-col items-center pt-3 gap-3 bg-[#1d1811] border-l border-white/10">
              <button
                onClick={() => store.updateSettings({ gitPanelCollapsed: false })}
                className="p-1.5 rounded-md text-[#a99a86] hover:text-accent hover:bg-white/[0.06] transition-colors"
                title="Expand git panel"
              >
                <PanelRightOpen size={16} />
              </button>
            </div>
          ) : (
            <GitPanel />
          )}
        </div>

        {overlayPanes.map((pane) => (
          <div
            key={pane.id}
            className="absolute inset-0 z-20 p-3 bg-black/70 backdrop-blur-sm animate-fade-in"
          >
            <div className="h-full w-full flex flex-col rounded-2xl border border-white/15 bg-[#1d1811] overflow-hidden animate-slide-up">
              <div className="h-10 shrink-0 flex items-center justify-between px-4 border-b border-white/10">
                <div className="flex items-center gap-2 min-w-0 text-xs font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                  <span className="font-mono font-semibold truncate">{pane.title ?? "Terminal"}</span>
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
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[#6f6455] hover:bg-rose-500/20 hover:text-rose-300 transition-colors"
                  title="Close"
                >
                  <X size={13} />
                  <span className="text-[10px]">Close</span>
                </button>
              </div>
              <div className="flex-1 min-h-0 relative bg-[#0e0b08] overflow-hidden">
                <TerminalPane paneId={pane.id} visible />
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
            onOpenFileFinder={() => {
              setShowPalette(false);
              setShowFileFinder(true);
            }}
          />
        )}

        {showFileFinder && project && (
          <FileFinder
            projectRoot={project.root}
            onOpenFile={setOpenedFile}
            onClose={() => setShowFileFinder(false)}
          />
        )}

        {openedFile && (
          <FileEditorDialog
            absPath={openedFile.absPath}
            repoRoot={openedFile.repoRoot}
            relPath={openedFile.relPath}
            onClose={() => setOpenedFile(null)}
          />
        )}

        <footer className="h-7 shrink-0 px-5 flex items-center justify-between text-[11px] font-mono text-[#6f6455] border-t border-white/10">
          <span className="flex items-center gap-1.5">
            <span
              className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-soft"
              style={{ boxShadow: "0 0 6px 1px var(--color-accent)" }}
            />
            SYSTEM NOMINAL
          </span>
          <span className="hidden sm:inline-flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 rounded bg-black/30 border border-white/10 text-[10px]">
              ⌘K
            </kbd>
            <span>commands</span>
            <span className="text-white/10 mx-1">·</span>
            <kbd className="px-1.5 py-0.5 rounded bg-black/30 border border-white/10 text-[10px]">
              ⌘⇧T
            </kbd>
            <span>new bay</span>
            <span className="text-white/10 mx-1">·</span>
            <span>drag headers to rearrange</span>
          </span>
        </footer>
      </div>
      </div>
    </div>
  );
}
