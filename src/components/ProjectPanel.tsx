import { useEffect, useMemo, useState } from "react";
import { useWorkspaceStore } from "../store/workspaceStore";
import {
  gitBranch,
  gitBranches,
  gitCheckout,
  gitRoot,
  gitStatus,
  GitStatusEntry,
} from "../lib/tauri";
import {
  Check,
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  GitBranch,
  Plus,
  RefreshCw,
  SquareTerminal,
  X,
} from "lucide-react";

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
  const pager =
    "{ if command -v delta >/dev/null 2>&1; then delta --line-numbers; elif command -v diff-so-fancy >/dev/null 2>&1; then diff-so-fancy; else cat; fi; } | less --tabs=4 -RFX";
  const diffCmd =
    status === "??"
      ? `git -C ${qRoot} diff --color=always --no-index /dev/null ${qPath} | ${pager}; true`
      : `git -C ${qRoot} diff --color=always HEAD -- ${qPath} | ${pager}`;
  store.addOverlayPane(
    `sh -c ${quotedShell(diffCmd)}`,
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

interface TreeDir {
  name: string;
  path: string;
  dirs: TreeDir[];
  files: { name: string; entry: GitStatusEntry }[];
}

function buildTree(entries: GitStatusEntry[]): TreeDir {
  const root: TreeDir = { name: "", path: "", dirs: [], files: [] };
  const dirMap = new Map<string, TreeDir>([["", root]]);

  const ensureDir = (path: string): TreeDir => {
    const existing = dirMap.get(path);
    if (existing) return existing;
    const idx = path.lastIndexOf("/");
    const parent = ensureDir(idx === -1 ? "" : path.slice(0, idx));
    const dir: TreeDir = {
      name: idx === -1 ? path : path.slice(idx + 1),
      path,
      dirs: [],
      files: [],
    };
    dirMap.set(path, dir);
    parent.dirs.push(dir);
    return dir;
  };

  for (const e of entries) {
    const parts = e.path.split("/");
    const name = parts.pop() ?? e.path;
    const dir = ensureDir(parts.join("/"));
    dir.files.push({ name, entry: e });
  }

  const compress = (dir: TreeDir): TreeDir => {
    dir.dirs = dir.dirs.map(compress);
    while (dir.dirs.length === 1 && dir.files.length === 0) {
      const only = dir.dirs[0];
      dir.name = dir.name ? `${dir.name}/${only.name}` : only.name;
      dir.path = only.path;
      dir.dirs = only.dirs;
      dir.files = only.files;
    }
    return dir;
  };
  root.dirs = root.dirs.map(compress);

  const sortDir = (dir: TreeDir) => {
    dir.dirs.sort((a, b) => a.name.localeCompare(b.name));
    dir.files.sort((a, b) => a.name.localeCompare(b.name));
    dir.dirs.forEach(sortDir);
  };
  sortDir(root);

  return root;
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
