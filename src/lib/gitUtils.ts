import { GitStatusEntry } from "./tauri";

export function projectName(root: string) {
  return (
    root
      .split(/[\/\\]/)
      .filter(Boolean)
      .pop() ?? root
  );
}

export function statusColor(status: string) {
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

export function statusLabel(status: string) {
  if (status === "??") return "untracked";
  if (status === "!!") return "ignored";
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
  if (map[status]) return map[status];
  if (status.startsWith("R")) return "renamed";
  if (status.startsWith("C")) return "copied";
  return status.trim() || "unchanged";
}

export function quotedShell(s: string) {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export interface TreeDir {
  name: string;
  path: string;
  dirs: TreeDir[];
  files: { name: string; entry: GitStatusEntry }[];
}

export function buildTree(entries: GitStatusEntry[]): TreeDir {
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
