import { useWorkspaceStore } from "../store/workspaceStore";
import { pickDirectory } from "../lib/tauri";
import { releaseLspSession } from "../lib/lspClient";
import { projectName } from "../lib/gitUtils";
import { Folder, Plus, X } from "lucide-react";

export function ProjectPanel() {
  const store = useWorkspaceStore();
  const workspace = store.getActiveWorkspace();

  const handleAddProject = async () => {
    const path = await pickDirectory();
    if (path) store.addProject(path);
  };

  if (!workspace) return null;

  return (
    <div className="shrink-0 px-3 py-4 border-t border-white/10 space-y-2">
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-display font-semibold text-[#6f6455] uppercase tracking-widest">
          Projects
        </span>
        <button
          onClick={handleAddProject}
          className="p-1 rounded-md text-[#a99a86] hover:text-accent hover:bg-white/[0.05] transition-colors"
          title="Add project"
        >
          <Plus size={13} />
        </button>
      </div>

      <div className="space-y-0.5 max-h-40 overflow-auto">
        {workspace.projects.length === 0 ? (
          <div className="text-center py-4 rounded-xl border border-dashed border-white/10 bg-[#1d1811]/40">
            <p className="text-xs text-[#8a7c68] mb-2">No projects yet</p>
            <button
              onClick={handleAddProject}
              className="text-xs px-2.5 py-1.5 rounded-md bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20 transition-colors"
            >
              Add Project
            </button>
          </div>
        ) : (
          workspace.projects.map((p) => {
            const isActive = p.id === workspace.activeProjectId;
            return (
              <div
                key={p.id}
                onClick={() => store.setActiveProject(p.id)}
                className={`group flex items-center gap-2.5 px-2 py-1.5 rounded-md text-[13px] cursor-pointer transition-colors border ${
                  isActive
                    ? "bg-accent/10 border-accent/30 text-[#f3e9d8]"
                    : "bg-transparent border-transparent text-[#a99a86] hover:bg-white/[0.04] hover:text-[#f3e9d8]"
                }`}
              >
                <Folder size={13} className={isActive ? "text-accent shrink-0" : "text-[#8a7c68] shrink-0"} />
                <span className="flex-1 truncate">{projectName(p.root)}</span>
                {workspace.projects.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      // Project removal is the boundary that bounds LSP
                      // process lifetime: typescript-language-server forks
                      // tsserver (hundreds of MB on a mid-size project) and
                      // nothing else kills it before app exit.
                      releaseLspSession(p.root);
                      store.removeProject(p.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded text-[#8a7c68] hover:text-rose-300 hover:bg-rose-500/20 transition-all"
                    title="Remove project"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
