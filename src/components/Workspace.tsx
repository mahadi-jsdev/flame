import { useEffect } from "react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { Sidebar } from "./Sidebar";
import { TerminalPane } from "./TerminalPane";
import { Plus, X, Terminal, Command, Cpu } from "lucide-react";

function getGridLayout(count: number) {
  if (count <= 1) return { cols: 1, rows: 1 };
  if (count <= 2) return { cols: 1, rows: 2 };
  if (count <= 4) return { cols: 2, rows: 2 };
  const cols = 3;
  return { cols, rows: Math.ceil(count / cols) };
}

export function Workspace() {
  const store = useWorkspaceStore();
  const workspace = store.getActiveWorkspace();
  const panes = workspace?.panes ?? [];
  const count = panes.length;
  const activeTerminalId = workspace?.activeTerminalId ?? null;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const ctrlOrCmd = e.ctrlKey || e.metaKey;
      if (!ctrlOrCmd || !e.shiftKey) return;

      if (e.key.toLowerCase() === "t") {
        e.preventDefault();
        store.addPane();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [store]);

  const { cols, rows } = getGridLayout(count);
  const allCount = store.workspaces.length;
  const label = workspace ? workspace.name : "Workspace";

  const activeIndex = panes.findIndex((p) => p.sessionId === activeTerminalId);
  const activeNumber = activeIndex >= 0 ? activeIndex + 1 : count > 0 ? 1 : 0;

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-[#05070a] text-slate-100 selection:bg-cyan-500/30 font-sans antialiased">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0 relative">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_#0e4e63_0%,_#05070a_60%)] opacity-60 pointer-events-none" />

        <header className="h-14 shrink-0 px-5 flex items-center justify-between bg-slate-950/60 backdrop-blur-xl border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-cyan-500 to-violet-600 shadow-lg shadow-cyan-500/20">
              <Cpu size={18} className="text-white" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-bold tracking-tight bg-gradient-to-r from-cyan-300 to-violet-300 bg-clip-text text-transparent">
                {label}
              </span>
              <span className="text-[10px] text-slate-400 mt-0.5">
                {count} terminal{count === 1 ? "" : "s"} · {allCount} workspace{allCount === 1 ? "" : "s"}
              </span>
            </div>
          </div>

          <button
            onClick={() => store.addPane()}
            className="group flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-white/10 hover:border-cyan-400/40 transition-all hover:shadow-[0_0_20px_rgba(34,211,238,0.15)] text-xs font-medium"
          >
            <Plus
              size={14}
              className="text-slate-400 group-hover:text-cyan-300 transition-colors"
            />
            <span>New Terminal</span>
            <span className="hidden sm:inline-flex items-center gap-1 text-[10px] text-slate-500 bg-slate-900/80 px-1.5 py-0.5 rounded border border-white/5">
              <Command size={10} />
              <span>+</span>
              <span>Shift</span>
              <span>+ T</span>
            </span>
          </button>
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
            return (
              <div
                key={pane.id}
                className="terminal-card min-h-0 h-full w-full flex flex-col rounded-2xl border border-white/10 bg-slate-900/60 backdrop-blur-sm shadow-2xl shadow-black/40 overflow-hidden hover:border-cyan-500/20 hover:shadow-[0_0_30px_rgba(34,211,238,0.08)] transition-all duration-300"
              >
                <div className="h-10 shrink-0 flex items-center justify-between px-3 bg-slate-900/80 border-b border-white/10">
                  <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
                    <Terminal size={13} className="text-cyan-400" />
                    <span>Terminal {index + 1}</span>
                    {pane.shell && (
                      <span className="text-[10px] text-slate-500 font-mono border-l border-white/10 pl-2">
                        {pane.shell}
                      </span>
                    )}
                    {isActive && (
                      <span className="ml-1 inline-flex items-center gap-1.5 pl-1.5 pr-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-[10px] text-cyan-300">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.6)]" />
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
                <div className="flex-1 min-h-0 relative bg-[#080c14]">
                  <TerminalPane paneId={pane.id} />
                </div>
              </div>
            );
          })}
        </main>

        <footer className="h-7 shrink-0 px-5 flex items-center justify-between text-[11px] text-slate-500 bg-slate-950/60 backdrop-blur border-t border-white/10">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
            PTY engine ready
            {activeNumber > 0 && (
              <span className="ml-2 inline-flex items-center gap-1.5 text-slate-400">
                <Terminal size={12} className="text-cyan-400" />
                Terminal {activeNumber} active
              </span>
            )}
          </span>
          <span className="hidden sm:inline">
            Ctrl/Cmd + Shift + T → new terminal
          </span>
        </footer>
      </div>
    </div>
  );
}
