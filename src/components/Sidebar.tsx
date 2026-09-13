import { useState } from "react";
import { useWorkspaceStore, Workspace } from "../store/workspaceStore";
import { ProjectPanel } from "./ProjectPanel";
import { Plus, X, Layers, Pencil, Cpu } from "lucide-react";

export function Sidebar() {
  const store = useWorkspaceStore();
  const workspaces = store.workspaces;
  const activeId = store.activeWorkspaceId ?? workspaces[0]?.id ?? null;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const startRename = (w: Workspace) => {
    setEditingId(w.id);
    setEditingName(w.name);
  };

  const commitRename = () => {
    const name = editingName.trim();
    if (editingId && name) store.renameWorkspace(editingId, name);
    setEditingId(null);
  };

  return (
    <div className="w-72 h-full flex flex-col overflow-hidden bg-slate-950/60 backdrop-blur-xl border-r border-white/10 animate-fade-in">
      <div className="h-14 shrink-0 flex items-center gap-2.5 px-5 border-b border-white/10">
        <div className="p-1.5 rounded-lg bg-gradient-to-br from-cyan-500 to-violet-600 shadow-md shadow-cyan-500/20 ring-1 ring-white/20">
          <Cpu size={14} className="text-white" />
        </div>
        <span className="text-sm font-bold tracking-tight bg-gradient-to-r from-cyan-300 to-violet-300 bg-clip-text text-transparent">
          Agent
        </span>
      </div>

      <div className="shrink-0 p-4 border-b border-white/10">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
            Workspaces
          </span>
          <button
            onClick={() => store.addWorkspace()}
            className="p-1.5 rounded-md text-slate-400 hover:text-cyan-300 hover:bg-slate-800/60 transition-all"
            title="New workspace"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="space-y-1.5">
          {workspaces.map((w) => {
            const isActive = w.id === activeId;
            return (
              <div
                key={w.id}
                onClick={() => store.setActiveWorkspace(w.id)}
                className={`group flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-all duration-200 border ${
                  isActive
                    ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-100"
                    : "bg-slate-900/40 border-transparent text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                }`}
              >
                {editingId === w.id ? (
                  <input
                    autoFocus
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onFocus={(e) => e.target.select()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    onBlur={commitRename}
                    className="flex-1 min-w-0 bg-slate-900/80 border border-cyan-500/40 rounded px-1.5 py-0.5 text-sm text-cyan-100 outline-none"
                  />
                ) : (
                  <span
                    className="flex items-center gap-2.5 truncate"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      startRename(w);
                    }}
                  >
                    <Layers
                      size={14}
                      className={isActive ? "text-cyan-400" : "text-slate-500"}
                    />
                    <span className="truncate">{w.name}</span>
                  </span>
                )}
                {editingId !== w.id && (
                  <span className="flex items-center shrink-0">
                    <span
                      className="mr-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono text-slate-500 bg-slate-900/60 border border-white/5 group-hover:opacity-0 transition-opacity"
                      title={`${w.panes.length} terminal${w.panes.length === 1 ? "" : "s"}`}
                    >
                      {w.panes.length}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        startRename(w);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-500 hover:text-cyan-300 hover:bg-slate-800/60 transition-all"
                      title="Rename workspace"
                    >
                      <Pencil size={12} />
                    </button>
                    {workspaces.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          store.removeWorkspace(w.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-500 hover:text-rose-300 hover:bg-rose-500/20 transition-all"
                        title="Close workspace"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <ProjectPanel />
    </div>
  );
}
