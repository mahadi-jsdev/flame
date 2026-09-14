import { useState } from "react";
import { useWorkspaceStore, Workspace } from "../store/workspaceStore";
import { ProjectPanel } from "./ProjectPanel";
import {
  Plus,
  X,
  Pencil,
  Cpu,
  Bookmark,
  LayoutTemplate,
  Rocket,
  PanelLeftClose,
} from "lucide-react";

export function Sidebar() {
  const store = useWorkspaceStore();
  const workspaces = store.workspaces;
  const activeId = store.activeWorkspaceId ?? workspaces[0]?.id ?? null;
  const activeWorkspace = workspaces.find((w) => w.id === activeId);

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

  const saveAsTemplate = (w: Workspace) => {
    const name = window.prompt("Save workspace as template named:", w.name);
    if (name && name.trim()) store.saveWorkspaceTemplate(w.id, name.trim());
  };

  const taggedPanes =
    activeWorkspace?.panes.filter((p) => !p.overlay && p.color && p.title) ?? [];

  return (
    <div className="w-60 h-full flex flex-col overflow-hidden bg-[#1d1811] border-r border-white/10 animate-fade-in">
      <div className="h-14 shrink-0 flex items-center gap-2.5 px-4 border-b border-white/10">
        <div className="p-1.5 rounded-lg bg-gradient-to-br from-accent to-accent-2 ring-1 ring-white/10">
          <Cpu size={14} className="text-[#1a1006]" />
        </div>
        <span className="font-display text-[13px] font-semibold tracking-wide text-[#f3e9d8] flex-1">
          HANGAR
        </span>
        <button
          onClick={() => store.updateSettings({ sidebarCollapsed: true })}
          className="p-1 rounded-md text-[#a99a86] hover:text-accent hover:bg-white/[0.05] transition-colors"
          title="Collapse sidebar"
        >
          <PanelLeftClose size={14} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-6">
        <div>
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-[10px] font-display font-semibold text-[#6f6455] uppercase tracking-widest">
              Workspaces
            </span>
            <button
              onClick={() => store.addWorkspace()}
              className="p-1 rounded-md text-[#a99a86] hover:text-accent hover:bg-white/[0.05] transition-colors"
              title="New workspace"
            >
              <Plus size={13} />
            </button>
          </div>
          <div className="space-y-0.5">
            {workspaces.map((w) => {
              const isActive = w.id === activeId;
              return (
                <div
                  key={w.id}
                  onClick={() => store.setActiveWorkspace(w.id)}
                  className={`group flex items-center gap-2.5 px-2 py-1.5 rounded-md text-[13px] font-medium cursor-pointer transition-colors border ${
                    isActive
                      ? "bg-accent/10 border-accent/30 text-[#f3e9d8]"
                      : "bg-transparent border-transparent text-[#a99a86] hover:bg-white/[0.04] hover:text-[#f3e9d8]"
                  }`}
                >
                  <span
                    className={`shrink-0 w-2 h-2 rounded-sm ${isActive ? "bg-accent" : "bg-[#6f6455]"}`}
                    style={isActive ? { boxShadow: "0 0 6px 1px var(--color-accent)" } : undefined}
                  />
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
                      className="flex-1 min-w-0 bg-black/30 border border-accent/40 rounded px-1.5 py-0.5 text-[13px] text-accent outline-none"
                    />
                  ) : (
                    <span
                      className="flex-1 truncate"
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        startRename(w);
                      }}
                    >
                      {w.name}
                    </span>
                  )}
                  {editingId !== w.id && (
                    <span className="flex items-center shrink-0">
                      <span
                        className="mr-0.5 font-mono text-[10px] text-[#6f6455] group-hover:opacity-0 transition-opacity"
                        title={`${w.panes.length} terminal${w.panes.length === 1 ? "" : "s"}`}
                      >
                        {w.panes.length}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          startRename(w);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded text-[#6f6455] hover:text-accent hover:bg-white/[0.06] transition-all"
                        title="Rename workspace"
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          saveAsTemplate(w);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded text-[#6f6455] hover:text-accent-2 hover:bg-white/[0.06] transition-all"
                        title="Save as template"
                      >
                        <Bookmark size={11} />
                      </button>
                      {workspaces.length > 1 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            store.removeWorkspace(w.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded text-[#6f6455] hover:text-rose-300 hover:bg-rose-500/20 transition-all"
                          title="Close workspace"
                        >
                          <X size={11} />
                        </button>
                      )}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {store.templates.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2 px-1 text-[10px] font-display font-semibold text-[#6f6455] uppercase tracking-widest">
              <LayoutTemplate size={11} />
              Templates
            </div>
            <div className="space-y-0.5">
              {store.templates.map((t) => (
                <div
                  key={t.id}
                  className="group flex items-center justify-between px-2 py-1.5 rounded-md text-[12.5px] text-[#a99a86] hover:bg-white/[0.04] transition-colors"
                >
                  <span className="truncate">{t.name}</span>
                  <span className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => store.createWorkspaceFromTemplate(t.id)}
                      className="p-1 rounded text-[#6f6455] hover:text-accent hover:bg-white/[0.06] transition-all"
                      title="Launch workspace from template"
                    >
                      <Rocket size={11} />
                    </button>
                    <button
                      onClick={() => store.removeWorkspaceTemplate(t.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded text-[#6f6455] hover:text-rose-300 hover:bg-rose-500/20 transition-all"
                      title="Delete template"
                    >
                      <X size={11} />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {taggedPanes.length > 0 && (
          <div>
            <div className="text-[10px] font-display font-semibold text-[#6f6455] uppercase tracking-widest mb-2 px-1">
              Agents on deck
            </div>
            <div className="space-y-1">
              {taggedPanes.map((p) => (
                <div key={p.id} className="flex items-center gap-2 px-1 text-[12px] text-[#a99a86]">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                  <span className="truncate">{p.title}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <ProjectPanel />
    </div>
  );
}
