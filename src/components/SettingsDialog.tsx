import { useEffect, useState } from "react";
import { useWorkspaceStore, AppSettings } from "../store/workspaceStore";
import { deleteApiKey, hasApiKey, saveApiKey } from "../lib/tauri";
import { THEMES } from "../lib/themes";
import { Check, Loader2, Settings2, Trash2, X } from "lucide-react";

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="text-xs font-medium text-slate-200">{label}</div>
        {hint && (
          <div className="text-[10px] text-slate-500 mt-0.5">{hint}</div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex p-0.5 rounded-lg bg-slate-950/80 border border-white/10">
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
            o.value === value
              ? "bg-accent/15 text-accent shadow-sm"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useWorkspaceStore((s) => s.settings);
  const update = useWorkspaceStore((s) => s.updateSettings);

  const [keyConfigured, setKeyConfigured] = useState<boolean | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [editingKey, setEditingKey] = useState(false);
  const [savingKey, setSavingKey] = useState(false);

  useEffect(() => {
    hasApiKey()
      .then(setKeyConfigured)
      .catch(() => setKeyConfigured(false));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const saveKey = async () => {
    if (!keyDraft.trim()) return;
    setSavingKey(true);
    try {
      await saveApiKey(keyDraft.trim());
      setKeyConfigured(true);
      setEditingKey(false);
      setKeyDraft("");
    } finally {
      setSavingKey(false);
    }
  };

  const removeKey = async () => {
    setSavingKey(true);
    try {
      await deleteApiKey();
      setKeyConfigured(false);
    } finally {
      setSavingKey(false);
    }
  };

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-[440px] max-h-[80%] flex flex-col rounded-2xl border border-white/15 bg-slate-900/90 backdrop-blur-xl shadow-2xl shadow-black/60 ring-1 ring-accent/10 animate-slide-up overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-11 shrink-0 flex items-center justify-between px-4 border-b border-white/10">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
            <Settings2 size={13} className="text-accent" />
            Settings
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-500 hover:bg-rose-500/20 hover:text-rose-300 transition-colors"
            title="Close"
          >
            <X size={13} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-auto px-4 py-1 divide-y divide-white/5">
          <Row label="Font size" hint="Applies live to all terminals">
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={10}
                max={20}
                step={1}
                value={settings.fontSize}
                onChange={(e) => update({ fontSize: Number(e.target.value) })}
                className="w-24 accent-accent"
              />
              <span className="w-6 text-right text-[11px] font-mono text-slate-300">
                {settings.fontSize}
              </span>
            </div>
          </Row>

          <Row label="Cursor style">
            <Segmented<AppSettings["cursorStyle"]>
              value={settings.cursorStyle}
              onChange={(v) => update({ cursorStyle: v })}
              options={[
                { value: "bar", label: "Bar" },
                { value: "block", label: "Block" },
                { value: "underline", label: "Line" },
              ]}
            />
          </Row>

          <Row label="Cursor blink">
            <button
              onClick={() => update({ cursorBlink: !settings.cursorBlink })}
              className={`relative w-9 h-5 rounded-full transition-colors ${
                settings.cursorBlink ? "bg-accent/40" : "bg-slate-700"
              }`}
              title="Toggle cursor blink"
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
                  settings.cursorBlink ? "left-[18px]" : "left-0.5"
                }`}
              />
            </button>
          </Row>

          <Row label="Scrollback" hint="Lines kept per terminal">
            <Segmented<number>
              value={settings.scrollback}
              onChange={(v) => update({ scrollback: v })}
              options={[
                { value: 10000, label: "10k" },
                { value: 50000, label: "50k" },
                { value: 100000, label: "100k" },
                { value: 200000, label: "200k" },
              ]}
            />
          </Row>

          <Row label="Diff viewer" hint="Used when opening git diffs">
            <Segmented<AppSettings["diffViewer"]>
              value={settings.diffViewer}
              onChange={(v) => update({ diffViewer: v })}
              options={[
                { value: "auto", label: "Auto" },
                { value: "delta", label: "Delta" },
                { value: "diff-so-fancy", label: "DSF" },
                { value: "plain", label: "Plain" },
              ]}
            />
          </Row>

          <Row label="Notifications" hint="Alert when a long task finishes">
            <button
              onClick={() => update({ notifications: !settings.notifications })}
              className={`relative w-9 h-5 rounded-full transition-colors ${
                settings.notifications ? "bg-accent/40" : "bg-slate-700"
              }`}
              title="Toggle notifications"
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
                  settings.notifications ? "left-[18px]" : "left-0.5"
                }`}
              />
            </button>
          </Row>

          <Row
            label="Restore last session"
            hint="Reopen workspaces & panes on launch"
          >
            <button
              onClick={() => update({ restoreSession: !settings.restoreSession })}
              className={`relative w-9 h-5 rounded-full transition-colors ${
                settings.restoreSession ? "bg-accent/40" : "bg-slate-700"
              }`}
              title="Toggle session restore"
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
                  settings.restoreSession ? "left-[18px]" : "left-0.5"
                }`}
              />
            </button>
          </Row>

          <Row label="Terminal theme">
            <Segmented<string>
              value={settings.theme}
              onChange={(v) => update({ theme: v })}
              options={Object.entries(THEMES).map(([value, t]) => ({
                value,
                label: t.label,
              }))}
            />
          </Row>

          <Row
            label="OpenAI API key"
            hint="Stored in your OS keychain, used for AI auto-commit"
          >
            <div className="flex flex-col items-end gap-1.5">
              {keyConfigured === null ? (
                <Loader2 size={13} className="animate-spin text-slate-500" />
              ) : keyConfigured && !editingKey ? (
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 text-[11px] text-emerald-300">
                    <Check size={12} /> Configured
                  </span>
                  <button
                    onClick={() => setEditingKey(true)}
                    className="text-[10px] px-2 py-1 rounded-md bg-slate-800/80 border border-white/10 text-slate-300 hover:text-accent hover:border-accent/30 transition-colors"
                  >
                    Change
                  </button>
                  <button
                    onClick={removeKey}
                    disabled={savingKey}
                    className="p-1.5 rounded-md text-slate-500 hover:text-rose-300 hover:bg-rose-500/20 transition-colors disabled:opacity-50"
                    title="Remove key from keychain"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <input
                    type="password"
                    value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)}
                    placeholder="sk-..."
                    spellCheck={false}
                    autoComplete="off"
                    className="w-44 bg-slate-950/80 border border-white/10 rounded-lg px-2.5 py-1.5 text-[11px] font-mono text-slate-200 placeholder:text-slate-600 outline-none focus:border-accent/40"
                  />
                  <button
                    onClick={saveKey}
                    disabled={savingKey || !keyDraft.trim()}
                    className="text-[10px] px-2 py-1.5 rounded-md bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20 transition-colors disabled:opacity-50"
                  >
                    {savingKey ? "Saving…" : "Save"}
                  </button>
                </div>
              )}
            </div>
          </Row>

          <Row label="Commit model" hint="OpenAI model for commit messages">
            <input
              type="text"
              value={settings.commitModel}
              onChange={(e) => update({ commitModel: e.target.value })}
              placeholder="gpt-4o-mini"
              spellCheck={false}
              className="w-48 bg-slate-950/80 border border-white/10 rounded-lg px-2.5 py-1.5 text-[11px] font-mono text-slate-200 placeholder:text-slate-600 outline-none focus:border-accent/40"
            />
          </Row>
        </div>
      </div>
    </div>
  );
}
