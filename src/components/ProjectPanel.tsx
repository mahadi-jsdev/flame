import { useEffect, useMemo, useState } from "react";
import { useWorkspaceStore } from "../store/workspaceStore";
import {
  gitAutoCommit,
  gitBranch,
  gitBranches,
  gitCheckout,
  gitRoot,
  gitStatus,
  GitStatusEntry,
} from "../lib/tauri";
import {
  buildDiffCmd,
  buildTree,
  projectName,
  quotedShell,
  statusColor,
  statusLabel,
  TreeDir,
} from "../lib/gitUtils";
import {
  Check,
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  GitBranch,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  SquareTerminal,
  X,
} from "lucide-react";

function openGitDiffInTerminal(path: string, status: string, root: string) {
  const store = useWorkspaceStore.getState();
  const workspace = store.getActiveWorkspace();
  if (!workspace) return;
  store.addOverlayPane(
    buildDiffCmd(path, status, root, store.settings.diffViewer),
    `diff: ${path.split("/").pop()}`,
    workspace.id,
  );
}

function openLazygit(root: string) {
  const store = useWorkspaceStore.getState();
  const workspace = store.getActiveWorkspace();
  if (!workspace) return;
  store.addOverlayPane(
    `lazygit -p ${quotedShell(root)}`,
    "lazygit",
    workspace.id,
  );
}

export function ProjectPanel() {
  const store = useWorkspaceStore();
  const workspace = store.getActiveWorkspace();
  const project = workspace?.projects.find(
    (p) => p.id === workspace.activeProjectId,
  );

  const [entries, setEntries] = useState<GitStatusEntry[]>([]);
  const [repoRoot, setRepoRoot] = useState<string | null>(null);
  const [branch, setBranch] = useState<string | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [showBranches, setShowBranches] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [aiCommitting, setAiCommitting] = useState(false);
  const [lastCommit, setLastCommit] = useState<string | null>(null);
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

    try {
      setRepoRoot(await gitRoot(project.root));
    } catch {
      setRepoRoot(null);
    }
  };

  useEffect(() => {
    if (project) {
      refreshGit();
    } else {
      setEntries([]);
      setBranch(null);
      setRepoRoot(null);
    }
    setShowBranches(false);
  }, [project?.id, project?.root]);

  const handleAddProject = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({ directory: true });
    if (typeof path !== "string") return;
    store.addProject(path);
  };

  const toggleBranches = async () => {
    if (!project) return;
    if (!showBranches) {
      try {
        setBranches(await gitBranches(project.root));
      } catch {
        setBranches([]);
      }
    }
    setShowBranches((v) => !v);
  };

  const switchBranch = async (b: string) => {
    if (!project) return;
    setShowBranches(false);
    if (b === branch) return;
    try {
      await gitCheckout(project.root, b);
    } catch (e) {
      setError(String(e));
    }
    await refreshGit();
  };

  const autoCommit = async () => {
    if (!project) return;
    const { openaiApiKey, commitModel } = useWorkspaceStore.getState().settings;
    if (!openaiApiKey.trim()) {
      setError("Set an OpenAI API key in Settings to use AI auto-commit");
      return;
    }
    setAiCommitting(true);
    setError(null);
    try {
      const msg = await gitAutoCommit(
        repoRoot ?? project.root,
        openaiApiKey,
        commitModel,
      );
      setLastCommit(msg);
      await refreshGit();
    } catch (e) {
      setError(String(e));
    } finally {
      setAiCommitting(false);
    }
  };

  const toggleDir = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const tree = useMemo(() => buildTree(entries), [entries]);

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
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-3 pb-3">
        {project ? (
          <div className="pt-3 space-y-3">
            <div className="flex items-center justify-between">
              <button
                onClick={toggleBranches}
                className="flex items-center gap-2 min-w-0 text-sm text-slate-300 hover:text-cyan-300 transition-colors"
                title="Switch branch"
              >
                <GitBranch size={14} className="shrink-0 text-violet-400" />
                <span className="font-mono truncate">
                  {branch ?? "no branch"}
                </span>
                <ChevronDown
                  size={12}
                  className={`shrink-0 text-slate-500 transition-transform ${
                    showBranches ? "rotate-180" : ""
                  }`}
                />
              </button>
              <div className="flex items-center gap-1">
                <button
                  onClick={autoCommit}
                  disabled={aiCommitting}
                  className="p-1.5 rounded-md text-slate-400 hover:text-violet-300 hover:bg-slate-800/60 transition-all disabled:opacity-50"
                  title="AI auto-commit (stages all changes)"
                >
                  {aiCommitting ? (
                    <Loader2
                      size={13}
                      className="animate-spin text-violet-300"
                    />
                  ) : (
                    <Sparkles size={13} />
                  )}
                </button>
                <button
                  onClick={() => openLazygit(repoRoot ?? project.root)}
                  className="p-1.5 rounded-md text-slate-400 hover:text-cyan-300 hover:bg-slate-800/60 transition-all"
                  title="Open lazygit in a new terminal"
                >
                  <SquareTerminal size={13} />
                </button>
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
            </div>

            {showBranches && (
              <div className="rounded-lg border border-white/10 bg-slate-900/60 overflow-hidden animate-pop-in shadow-lg shadow-black/30">
                {branches.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-slate-500">
                    No local branches
                  </div>
                ) : (
                  branches.map((b) => (
                    <div
                      key={b}
                      onClick={() => switchBranch(b)}
                      className={`flex items-center gap-2 px-3 py-2 text-xs cursor-pointer transition-colors ${
                        b === branch
                          ? "bg-cyan-500/10 text-cyan-300"
                          : "text-slate-300 hover:bg-slate-800/60"
                      }`}
                    >
                      <Check
                        size={12}
                        className={`shrink-0 ${
                          b === branch ? "text-cyan-400" : "text-transparent"
                        }`}
                      />
                      <span className="truncate font-mono">{b}</span>
                    </div>
                  ))
                )}
              </div>
            )}

            {error && (
              <div className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2">
                {error}
              </div>
            )}

            {lastCommit && !error && (
              <div className="text-[11px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-2.5 py-2 flex items-start gap-1.5 animate-fade-in">
                <Check size={12} className="shrink-0 mt-0.5" />
                <span className="font-mono break-all">{lastCommit}</span>
              </div>
            )}

            {!error && entries.length === 0 && !loading && (
              <div className="text-center py-8 text-slate-500 text-xs">
                No changes
              </div>
            )}

            {entries.length > 0 && (
              <div className="space-y-0.5 animate-fade-in">
                <DirTree
                  dir={tree}
                  depth={0}
                  collapsed={collapsed}
                  onToggle={toggleDir}
                  root={repoRoot ?? project.root}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="h-40 flex flex-col items-center justify-center text-slate-500 text-center px-4">
            <FolderOpen size={28} className="mb-2 text-slate-700" />
            <p className="text-xs">Select or add a project to see changes</p>
          </div>
        )}
      </div>

      <div className="h-8 shrink-0 flex items-center px-4 text-xs text-slate-600 border-t border-white/10">
        {entries.length} change{entries.length === 1 ? "" : "s"}
      </div>
    </div>
  );
}

function DirTree({
  dir,
  depth,
  collapsed,
  onToggle,
  root,
}: {
  dir: TreeDir;
  depth: number;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  root: string;
}) {
  return (
    <>
      {dir.dirs.map((d) => {
        const isCollapsed = collapsed.has(d.path);
        return (
          <div key={d.path}>
            <div
              onClick={() => onToggle(d.path)}
              className="flex items-center gap-1.5 py-1.5 pr-2 rounded-md text-xs text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 cursor-pointer transition-colors"
              style={{ paddingLeft: `${depth * 14 + 4}px` }}
            >
              {isCollapsed ? (
                <ChevronRight size={12} className="shrink-0 text-slate-500" />
              ) : (
                <ChevronDown size={12} className="shrink-0 text-slate-500" />
              )}
              <Folder size={13} className="shrink-0 text-violet-400" />
              <span className="truncate">{d.name}</span>
            </div>
            {!isCollapsed && (
              <DirTree
                dir={d}
                depth={depth + 1}
                collapsed={collapsed}
                onToggle={onToggle}
                root={root}
              />
            )}
          </div>
        );
      })}
      {dir.files.map((f) => (
        <div
          key={f.entry.path}
          onClick={() =>
            openGitDiffInTerminal(f.entry.path, f.entry.status, root)
          }
          className="flex items-center gap-2 py-1.5 pr-2 rounded-md hover:bg-slate-800/60 transition-colors cursor-pointer"
          style={{ paddingLeft: `${depth * 14 + 21}px` }}
          title="Open git diff"
        >
          <File size={13} className="shrink-0 text-cyan-400" />
          <span className="text-xs text-slate-300 truncate flex-1 min-w-0">
            {f.entry.original_path ? (
              <>
                <span className="text-slate-500 line-through">
                  {f.entry.original_path.split("/").pop()}
                </span>
                {" → "}
                {f.name}
              </>
            ) : (
              f.name
            )}
          </span>
          <span
            className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border font-medium ${statusColor(
              f.entry.status,
            )}`}
            title={statusLabel(f.entry.status)}
          >
            {f.entry.status}
          </span>
        </div>
      ))}
    </>
  );
}
