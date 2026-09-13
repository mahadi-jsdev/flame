import { useEffect, useMemo, useState } from "react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { gitBranch, gitStatus, GitStatusEntry } from "../lib/tauri";
import {
  File,
  Folder,
  FolderOpen,
  RefreshCw,
  GitBranch,
  Plus,
  X,
} from "lucide-react";

type Tab = "files" | "git";

function projectName(root: string) {
  return (
    root
      .split(/[\/\\]/)
      .filter(Boolean)
      .pop() ?? root
  );
}

function statusColor(status: string) {
  if (status === "??")
    return "bg-slate-500/20 text-slate-400 border-slate-500/30";
  if (status === "!!")
    return "bg-slate-500/20 text-slate-400 border-slate-500/30";
  if (status[0] === "A" || status[1] === "A")
    return "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
  if (status[0] === "D" || status[1] === "D")
    return "bg-rose-500/20 text-rose-300 border-rose-500/30";
  if (status[0] === "M" || status[1] === "M")
    return "bg-amber-500/20 text-amber-300 border-amber-500/30";
  if (status[0] === "R" || status[1] === "R")
    return "bg-cyan-500/20 text-cyan-300 border-cyan-500/30";
  if (status[0] === "C" || status[1] === "C")
    return "bg-violet-500/20 text-violet-300 border-violet-500/30";
  return "bg-slate-500/20 text-slate-400 border-slate-500/30";
}

function quotedShell(s: string) {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function openGitDiffInTerminal(path: string, status: string, root: string) {
  const store = useWorkspaceStore.getState();
  const workspace = store.getActiveWorkspace();
  if (!workspace) return;
  const qPath = quotedShell(path);
  const qRoot = quotedShell(root);
  const diffCmd =
    status === "??"
      ? `git -C ${qRoot} diff --color=always --no-index /dev/null ${qPath} | { command -v diff-so-fancy >/dev/null 2>&1 && diff-so-fancy || cat; } | less --tabs=4 -RFX; true`
      : `git -C ${qRoot} diff --color=always HEAD -- ${qPath} | { command -v diff-so-fancy >/dev/null 2>&1 && diff-so-fancy || cat; } | less --tabs=4 -RFX`;
  store.addPane(workspace.id, `sh -c ${quotedShell(diffCmd)}`);
}

function statusLabel(status: string) {
  if (status === "??") return "untracked";
  if (status === "!!") return "ignored";
  if (status.startsWith("R")) return "renamed";
  if (status.startsWith("C")) return "copied";
  const map: Record<string, string> = {
    " M": "modified",
    "M ": "staged",
    " A": "added",
    "A ": "staged add",
    " D": "deleted",
    "D ": "staged del",
    MM: "staged + modified",
    AM: "added + modified",
    RM: "renamed + modified",
    CM: "copied + modified",
  };
  return (map[status] ?? status.trim()) || "unchanged";
}

export function ProjectPanel() {
  const store = useWorkspaceStore();
  const workspace = store.getActiveWorkspace();
  const project = workspace?.projects.find(
    (p) => p.id === workspace.activeProjectId,
  );

  const [tab, setTab] = useState<Tab>("files");
  const [entries, setEntries] = useState<GitStatusEntry[]>([]);
  const [branch, setBranch] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshGit = async () => {
    if (!project) return;
    setLoading(true);
    setError(null);
    try {
      const status = await gitStatus(project.root);
      setEntries(status);
    } catch (e) {
      setError(String(e));
      setEntries([]);
    } finally {
      setLoading(false);
    }

    try {
      const b = await gitBranch(project.root);
      setBranch(b);
    } catch {
      setBranch(null);
    }
  };

  useEffect(() => {
    if (tab === "git" && project) {
      refreshGit();
    }
  }, [tab, project?.id, project?.root]);

  const handleAddProject = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { invoke } = await import("@tauri-apps/api/core");
    const path = await open({ directory: true });
    if (typeof path !== "string") return;
    const list = await invoke<
      { name: string; path: string; is_dir: boolean }[]
    >("list_dir", { path });
    store.addProject(path, list);
  };

  const grouped = useMemo(() => {
    const staged = entries.filter((e) => "MACRD".includes(e.status[0]));
    const unstaged = entries.filter((e) => "MACRD".includes(e.status[1]));
    const untracked = entries.filter((e) => e.status === "??");
    return { staged, unstaged, untracked };
  }, [entries]);

  if (!workspace) return null;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 px-4 py-4 border-b border-white/10 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500 uppercase tracking-wider font-semibold">
            Projects
          </span>
          <button
            onClick={handleAddProject}
            className="p-1 rounded-md text-slate-400 hover:text-cyan-300 hover:bg-slate-800/60 transition-all"
            title="Add project"
          >
            <Plus size={13} />
          </button>
        </div>

        <div className="space-y-1.5 max-h-32 overflow-auto pr-0.5">
          {workspace.projects.length === 0 ? (
            <div className="text-center py-4 rounded-xl border border-dashed border-white/10 bg-slate-900/40">
              <p className="text-xs text-slate-500 mb-2">No projects yet</p>
              <button
                onClick={handleAddProject}
                className="text-xs px-2.5 py-1.5 rounded-md bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/20 transition-colors"
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
                  className={`group relative flex items-center justify-between pl-3.5 pr-2.5 py-2.5 rounded-lg text-sm cursor-pointer transition-all duration-200 border ${
                    isActive
                      ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-100"
                      : "bg-slate-900/40 border-transparent text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                  }`}
                >
                  <span className="flex items-center gap-2.5 truncate">
                    <Folder
                      size={14}
                      className={isActive ? "text-cyan-400" : "text-slate-500"}
                    />
                    <span className="truncate font-medium">
                      {projectName(p.root)}
                    </span>
                  </span>
                  {workspace.projects.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        store.removeProject(p.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-500 hover:text-rose-300 hover:bg-rose-500/20 transition-all"
                      title="Remove project"
                    >
                      <X size={12} />
                    </button>
                  )}
                  {isActive && (
                    <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-cyan-400" />
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="flex p-1 rounded-lg bg-slate-900/80 border border-white/10">
          <button
            onClick={() => setTab("files")}
            className={`flex-1 px-2 py-2 rounded-md text-xs font-medium transition-all duration-200 ${
              tab === "files"
                ? "bg-cyan-500/15 text-cyan-100 shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Files
          </button>
          <button
            onClick={() => setTab("git")}
            className={`flex-1 px-2 py-2 rounded-md text-xs font-medium transition-all duration-200 ${
              tab === "git"
                ? "bg-cyan-500/15 text-cyan-100 shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Git
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-3 pb-3">
        {tab === "files" ? (
          project ? (
            <div className="space-y-0.5 pt-2">
              {project.entries.map((e) => (
                <div
                  key={e.path}
                  className="flex items-center gap-2.5 py-2 px-2.5 rounded-lg text-sm text-slate-300 hover:bg-slate-800/60 hover:text-slate-100 transition-all duration-150 cursor-pointer group animate-fade-in"
                >
                  {e.is_dir ? (
                    <Folder
                      size={15}
                      className="text-violet-400 group-hover:text-violet-300 transition-colors"
                    />
                  ) : (
                    <File
                      size={15}
                      className="text-cyan-400 group-hover:text-cyan-300 transition-colors"
                    />
                  )}
                  <span className="truncate">{e.name}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-40 flex flex-col items-center justify-center text-slate-500 text-center px-4">
              <FolderOpen size={28} className="mb-2 text-slate-700" />
              <p className="text-xs">Select or add a project to see files</p>
            </div>
          )
        ) : (
          <div className="pt-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-slate-300">
                <GitBranch size={14} className="text-violet-400" />
                <span className="font-mono">{branch ?? "no branch"}</span>
              </div>
              <button
                onClick={refreshGit}
                disabled={loading}
                className="p-1.5 rounded-md text-slate-400 hover:text-cyan-300 hover:bg-slate-800/60 transition-all disabled:opacity-50"
                title="Refresh git status"
              >
                <RefreshCw
                  size={12}
                  className={loading ? "animate-spin" : ""}
                />
              </button>
            </div>

            {error && (
              <div className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2">
                {error}
              </div>
            )}

            {!error && entries.length === 0 && !loading && (
              <div className="text-center py-8 text-slate-500 text-xs">
                No changes
              </div>
            )}

            {entries.length > 0 && project && (
              <div className="space-y-2">
                <GitGroup
                  title="Staged"
                  entries={grouped.staged}
                  root={project.root}
                />
                <GitGroup
                  title="Unstaged"
                  entries={grouped.unstaged}
                  root={project.root}
                />
                <GitGroup
                  title="Untracked"
                  entries={grouped.untracked}
                  root={project.root}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="h-8 shrink-0 flex items-center px-4 text-xs text-slate-600 border-t border-white/10">
        {tab === "files"
          ? `${project?.entries.length ?? 0} item${(project?.entries.length ?? 0) === 1 ? "" : "s"}`
          : `${entries.length} change${entries.length === 1 ? "" : "s"}`}
      </div>
    </div>
  );
}

function GitGroup({
  title,
  entries,
  root,
}: {
  title: string;
  entries: GitStatusEntry[];
  root: string;
}) {
  if (entries.length === 0) return null;
  return (
    <div>
      <div className="text-xs text-slate-500 uppercase tracking-wider mb-2 px-1">
        {title}
      </div>
      <div className="space-y-1.5">
        {entries.map((e) => (
          <div
            key={e.path}
            onClick={() => openGitDiffInTerminal(e.path, e.status, root)}
            className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-slate-900/40 border border-white/5 hover:bg-slate-800/60 transition-colors cursor-pointer"
            title="Open git diff in a new terminal"
          >
            <span
              className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border font-medium ${statusColor(
                e.status,
              )}`}
              title={statusLabel(e.status)}
            >
              {e.status}
            </span>
            <File size={14} className="shrink-0 text-cyan-400" />
            <span className="text-xs text-slate-300 truncate flex-1 min-w-0">
              {e.original_path ? (
                <>
                  <span className="text-slate-500 line-through">
                    {e.original_path}
                  </span>
                  {" → "}
                  {e.path}
                </>
              ) : (
                e.path
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
