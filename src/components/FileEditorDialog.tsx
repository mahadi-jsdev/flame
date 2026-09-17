import { useEffect, useState } from "react";
import { gitDiffFile, readImageFile, readTextFile, writeTextFile } from "../lib/tauri";
import { statusColor, statusLabel } from "../lib/gitUtils";
import { isImagePath } from "../lib/codeLang";
import { CodeEditor } from "./CodeEditor";
import { Check, FileText, GitCompare, Loader2, Pencil, X } from "lucide-react";

function diffLineClass(line: string) {
  if (line.startsWith("+++") || line.startsWith("---")) return "text-[#8a7c68]";
  if (line.startsWith("+")) return "text-emerald-300 bg-emerald-500/[0.06]";
  if (line.startsWith("-")) return "text-rose-300 bg-rose-500/[0.06]";
  if (line.startsWith("@@")) return "text-accent-2";
  return "text-[#a99a86]";
}

interface FileEditorDialogProps {
  absPath: string;
  repoRoot: string;
  relPath: string;
  /** Omitted when opened via the file finder rather than the git changes
   * list — there's no known status to show, and nothing pre-fetched to
   * diff against, so this behaves the same as an untracked ("??") file:
   * default straight to Edit. The Diff tab is still available either way. */
  status?: string;
  onClose: () => void;
}

export function FileEditorDialog({
  absPath,
  repoRoot,
  relPath,
  status,
  onClose,
}: FileEditorDialogProps) {
  const isImage = isImagePath(relPath);
  const isUntracked = status === "??" || status === undefined;
  const [mode, setMode] = useState<"diff" | "edit">(isUntracked ? "edit" : "diff");

  const [content, setContent] = useState<string | null>(null);
  const [original, setOriginal] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = content !== null && original !== null && content !== original;

  useEffect(() => {
    let cancelled = false;
    if (isImage) {
      setLoading(true);
      setError(null);
      readImageFile(absPath)
        .then((url) => !cancelled && setImageSrc(url))
        .catch((e) => !cancelled && setError(String(e)))
        .finally(() => !cancelled && setLoading(false));
      return () => {
        cancelled = true;
      };
    }
    if (mode === "edit" && content === null) {
      setLoading(true);
      setError(null);
      readTextFile(absPath)
        .then((text) => {
          if (cancelled) return;
          setContent(text);
          setOriginal(text);
        })
        .catch((e) => !cancelled && setError(String(e)))
        .finally(() => !cancelled && setLoading(false));
    }
    if (mode === "diff" && diff === null && !isUntracked) {
      setLoading(true);
      setError(null);
      gitDiffFile(repoRoot, relPath)
        .then((text) => !cancelled && setDiff(text))
        .catch((e) => !cancelled && setError(String(e)))
        .finally(() => !cancelled && setLoading(false));
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const save = async () => {
    if (content === null || saving) return;
    setSaving(true);
    setError(null);
    try {
      await writeTextFile(absPath, content);
      setOriginal(content);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const ctrlOrCmd = e.ctrlKey || e.metaKey;
      if (ctrlOrCmd && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (mode === "edit") save();
      }
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, content]);

  const name = relPath.split("/").pop() ?? relPath;

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-[860px] max-w-[92%] h-[80%] flex flex-col rounded-2xl border border-white/15 bg-[#1d1811]/95 backdrop-blur-xl shadow-2xl shadow-black/60 ring-1 ring-accent/10 animate-slide-up overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-11 shrink-0 flex items-center justify-between px-4 border-b border-white/10 gap-3">
          <div className="flex items-center gap-2 min-w-0 text-xs font-semibold text-[#f3e9d8]">
            <FileText size={13} className="text-accent shrink-0" />
            <span className="truncate">{name}</span>
            {status && (
              <span
                className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border font-medium ${statusColor(status)}`}
                title={statusLabel(status)}
              >
                {status}
              </span>
            )}
            {dirty && (
              <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-accent" title="Unsaved changes" />
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!isImage && status !== undefined && (
              <div className="flex p-0.5 rounded-lg bg-[#0e0b08]/80 border border-white/10">
                <button
                  onClick={() => setMode("diff")}
                  className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-all ${
                    mode === "diff"
                      ? "bg-accent/15 text-accent shadow-sm"
                      : "text-[#a99a86] hover:text-[#f3e9d8]"
                  }`}
                >
                  <GitCompare size={11} />
                  Diff
                </button>
                <button
                  onClick={() => setMode("edit")}
                  className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-all ${
                    mode === "edit"
                      ? "bg-accent/15 text-accent shadow-sm"
                      : "text-[#a99a86] hover:text-[#f3e9d8]"
                  }`}
                >
                  <Pencil size={11} />
                  Edit
                </button>
              </div>
            )}
            {!isImage && mode === "edit" && (
              <button
                onClick={save}
                disabled={!dirty || saving}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-accent border border-accent hover:bg-[#ffbe57] hover:border-[#ffbe57] disabled:opacity-40 disabled:hover:bg-accent transition-colors text-[11px] font-semibold text-[#1a1006]"
                title="Save (Ctrl+S)"
              >
                {saving ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : saved ? (
                  <Check size={12} />
                ) : null}
                {saved ? "Saved" : "Save"}
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-[#8a7c68] hover:bg-rose-500/20 hover:text-rose-300 transition-colors"
              title="Close"
            >
              <X size={13} />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#1d1811]/60">
              <Loader2 size={18} className="animate-spin text-accent" />
            </div>
          )}
          {error && !loading && (
            <div className="p-4">
              <div className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg p-3">
                {error}
              </div>
            </div>
          )}
          {!error && isImage && imageSrc !== null && (
            <div
              className="h-full w-full flex items-center justify-center overflow-auto p-6"
              style={{
                backgroundImage:
                  "linear-gradient(45deg, #2a2318 25%, transparent 25%), linear-gradient(-45deg, #2a2318 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2318 75%), linear-gradient(-45deg, transparent 75%, #2a2318 75%)",
                backgroundSize: "20px 20px",
                backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
              }}
            >
              <img
                src={imageSrc}
                alt={name}
                className="max-w-full max-h-full object-contain rounded shadow-lg shadow-black/40"
              />
            </div>
          )}
          {!error && !isImage && mode === "edit" && content !== null && (
            <CodeEditor
              value={content}
              onChange={setContent}
              path={relPath}
              absPath={absPath}
              projectRoot={repoRoot}
              autoFocus
            />
          )}
          {!error && !isImage && mode === "diff" && !loading && isUntracked && (
            <div className="h-full flex flex-col items-center justify-center text-[#8a7c68] text-center px-4">
              <p className="text-xs">New file — nothing to diff yet.</p>
            </div>
          )}
          {!error && !isImage && mode === "diff" && diff !== null && !isUntracked && (
            <pre className="w-full h-full overflow-auto p-4 font-mono text-xs leading-relaxed whitespace-pre">
              {diff.trim() === "" ? (
                <span className="text-[#8a7c68]">No changes to show.</span>
              ) : (
                diff.split("\n").map((line, i) => (
                  <div key={i} className={diffLineClass(line)}>
                    {line || " "}
                  </div>
                ))
              )}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
