import { useEffect, useMemo, useRef, useState } from "react";
import { gitRoot, listProjectFiles } from "../lib/tauri";
import { fuzzyScore } from "../lib/fuzzy";
import { File, Search } from "lucide-react";

const MAX_RESULTS = 200;

export interface OpenedFileInfo {
  absPath: string;
  repoRoot: string;
  relPath: string;
}

interface FileFinderProps {
  projectRoot: string;
  onOpenFile: (info: OpenedFileInfo) => void;
  onClose: () => void;
}

export function FileFinder({ projectRoot, onOpenFile, onClose }: FileFinderProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [files, setFiles] = useState<string[]>([]);
  const [repoRoot, setRepoRoot] = useState(projectRoot);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      gitRoot(projectRoot).catch(() => projectRoot),
      listProjectFiles(projectRoot),
    ])
      .then(([root, list]) => {
        if (cancelled) return;
        setRepoRoot(root);
        setFiles(list);
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [projectRoot]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    if (!query.trim()) return files.slice(0, MAX_RESULTS);
    return files
      .map((f) => ({ f, score: fuzzyScore(query, f) }))
      .filter((x): x is { f: string; score: number } => x.score !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS)
      .map((x) => x.f);
  }, [files, query]);

  const openFile = (relPath: string) => {
    onOpenFile({
      absPath: `${repoRoot.replace(/\/$/, "")}/${relPath}`,
      repoRoot,
      relPath,
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center pt-24 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-[480px] max-h-[60%] flex flex-col rounded-2xl border border-white/15 bg-[#1d1811]/90 backdrop-blur-xl shadow-2xl shadow-black/60 ring-1 ring-accent/10 animate-slide-up overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-11 shrink-0 flex items-center gap-2 px-3 border-b border-white/10">
          <Search size={14} className="text-[#8a7c68] shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelected((s) => Math.min(s + 1, filtered.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelected((s) => Math.max(s - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const f = filtered[selected];
                if (f) openFile(f);
              }
            }}
            placeholder="Go to file…"
            spellCheck={false}
            className="flex-1 bg-transparent text-sm text-[#f3e9d8] placeholder:text-[#6f6455] outline-none"
          />
        </div>

        <div className="flex-1 min-h-0 overflow-auto py-1">
          {loading ? (
            <div className="px-4 py-6 text-center text-xs text-[#8a7c68]">Indexing files…</div>
          ) : error ? (
            <div className="px-4 py-6 text-center text-xs text-rose-300">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-[#8a7c68]">No matching files</div>
          ) : (
            filtered.map((f, i) => {
              const name = f.split("/").pop() ?? f;
              const dir = f.slice(0, Math.max(0, f.length - name.length - 1));
              return (
                <div
                  key={f}
                  onMouseEnter={() => setSelected(i)}
                  onClick={() => openFile(f)}
                  className={`flex items-center gap-2.5 px-3.5 py-2 mx-1 rounded-lg cursor-pointer text-xs transition-colors ${
                    i === selected
                      ? "bg-accent/10 text-accent"
                      : "text-[#d9cbb5] hover:bg-[#2a2318]/60"
                  }`}
                >
                  <File
                    size={13}
                    className={`shrink-0 ${i === selected ? "text-accent" : "text-[#8a7c68]"}`}
                  />
                  <span className="truncate flex-1">{name}</span>
                  {dir && (
                    <span className="text-[10px] text-[#8a7c68] truncate max-w-[45%]">{dir}</span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
