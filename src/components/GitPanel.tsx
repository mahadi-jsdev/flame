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
  buildTree,
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
  RefreshCw,
  Sparkles,
  SquareTerminal,
} from "lucide-react";

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

export function GitPanel() {
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
    setLastCommit(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, project?.root]);

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
    const { commitModel } = useWorkspaceStore.getState().settings;
    setAiCommitting(true);
    setError(null);
    try {
      const msg = await gitAutoCommit(repoRoot ?? project.root, commitModel);
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
    <aside className="w-80 shrink-0 flex flex-col rounded-2xl border border-white/10 bg-[#1d1811]/70 overflow-hidden">
      <div className="shrink-0 px-4 py-3 border-b border-white/10 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="font-display text-[11px] font-semibold text-[#a99a86] uppercase tracking-widest">
            Changes
          </span>
          {project && (
            <button
              onClick={toggleBranches}
              className="flex items-center gap-1.5 min-w-0 px-2 py-1 rounded-full bg-black/30 border border-white/10 text-[11px] font-mono text-[#d9cbb5] hover:border-accent/30 transition-colors"
              title="Switch branch"
            >
              <GitBranch size={11} className="shrink-0 text-accent-2" />
              <span className="truncate max-w-[110px]">{branch ?? "no branch"}</span>
              <ChevronDown
                size={10}
                className={`shrink-0 text-[#6f6455] transition-transform ${showBranches ? "rotate-180" : ""}`}
              />
            </button>
          )}
        </div>
        {project && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={autoCommit}
              disabled={aiCommitting}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 hover:border-accent/30 text-[11px] font-medium text-[#a99a86] hover:text-[#f3e9d8] transition-colors disabled:opacity-50"
              title="AI auto-commit (stages all changes)"
            >
              {aiCommitting ? (
                <Loader2 size={12} className="animate-spin text-accent-2" />
              ) : (
                <Sparkles size={12} />
              )}
              Auto-commit
            </button>
            <button
              onClick={() => openLazygit(repoRoot ?? project.root)}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 hover:border-accent/30 text-[11px] font-medium text-[#a99a86] hover:text-[#f3e9d8] transition-colors"
              title="Open lazygit in a new terminal"
            >
              <SquareTerminal size={12} />
              Lazygit
            </button>
            <button
              onClick={refreshGit}
              disabled={loading}
              className="p-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 hover:border-accent/30 text-[#a99a86] hover:text-[#f3e9d8] transition-colors disabled:opacity-50"
              title="Refresh git status"
            >
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        )}

        {showBranches && (
          <div className="rounded-lg border border-white/10 bg-[#1d1811] overflow-hidden animate-pop-in shadow-lg shadow-black/30 max-h-40 overflow-y-auto">
            {branches.length === 0 ? (
              <div className="px-3 py-2 text-xs text-[#8a7c68]">No local branches</div>
            ) : (
              branches.map((b) => (
                <div
                  key={b}
                  onClick={() => switchBranch(b)}
                  className={`flex items-center gap-2 px-3 py-2 text-xs cursor-pointer transition-colors ${
                    b === branch ? "bg-accent/10 text-accent" : "text-[#d9cbb5] hover:bg-[#2a2318]/60"
                  }`}
                >
                  <Check size={12} className={`shrink-0 ${b === branch ? "text-accent" : "text-transparent"}`} />
                  <span className="truncate font-mono">{b}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
        {!project ? (
          <div className="h-full flex flex-col items-center justify-center text-[#8a7c68] text-center px-4">
            <FolderOpen size={26} className="mb-2 text-[#352c1e]" />
            <p className="text-xs">Select or add a project to see changes</p>
          </div>
        ) : (
          <>
            {error && (
              <div className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2 mb-2">
                {error}
              </div>
            )}
            {lastCommit && !error && (
              <div className="text-[11px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-2.5 py-2 flex items-start gap-1.5 animate-fade-in mb-2">
                <Check size={12} className="shrink-0 mt-0.5" />
                <span className="font-mono break-all">{lastCommit}</span>
              </div>
            )}
            {!error && entries.length === 0 && !loading && (
              <div className="text-center py-8 text-[#8a7c68] text-xs">No changes</div>
            )}
            {entries.length > 0 && (
              <div className="space-y-0.5 animate-fade-in">
                <DirTree
                  dir={tree}
                  depth={0}
                  collapsed={collapsed}
                  onToggle={toggleDir}
                />
              </div>
            )}
          </>
        )}
      </div>

      <div className="h-8 shrink-0 flex items-center px-4 text-xs text-[#6f6455] border-t border-white/10">
        {entries.length} change{entries.length === 1 ? "" : "s"}
      </div>
    </aside>
  );
}

function DirTree({
  dir,
  depth,
  collapsed,
  onToggle,
}: {
  dir: TreeDir;
  depth: number;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
}) {
  return (
    <>
      {dir.dirs.map((d) => {
        const isCollapsed = collapsed.has(d.path);
        return (
          <div key={d.path}>
            <div
              onClick={() => onToggle(d.path)}
              className="flex items-center gap-1.5 py-1.5 pr-2 rounded-md text-xs text-[#a99a86] hover:bg-[#2a2318]/60 hover:text-[#f3e9d8] cursor-pointer transition-colors"
              style={{ paddingLeft: `${depth * 14 + 4}px` }}
            >
              {isCollapsed ? (
                <ChevronRight size={12} className="shrink-0 text-[#8a7c68]" />
              ) : (
                <ChevronDown size={12} className="shrink-0 text-[#8a7c68]" />
              )}
              <Folder size={13} className="shrink-0 text-accent-2" />
              <span className="truncate">{d.name}</span>
            </div>
            {!isCollapsed && (
              <DirTree dir={d} depth={depth + 1} collapsed={collapsed} onToggle={onToggle} />
            )}
          </div>
        );
      })}
      {dir.files.map((f) => (
        <div
          key={f.entry.path}
          className="flex items-center gap-2 py-1.5 pr-2 rounded-md"
          style={{ paddingLeft: `${depth * 14 + 21}px` }}
        >
          <File size={13} className="shrink-0 text-accent" />
          <span className="text-xs text-[#d9cbb5] truncate flex-1 min-w-0">
            {f.entry.original_path ? (
              <>
                <span className="text-[#8a7c68] line-through">{f.entry.original_path.split("/").pop()}</span>
                {" → "}
                {f.name}
              </>
            ) : (
              f.name
            )}
          </span>
          <span
            className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border font-medium ${statusColor(f.entry.status)}`}
            title={statusLabel(f.entry.status)}
          >
            {f.entry.status}
          </span>
        </div>
      ))}
    </>
  );
}
