import { useEffect, useMemo, useRef, useState } from "react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { pickDirectory } from "../lib/tauri";
import { quotedShell } from "../lib/gitUtils";
import {
  FileSearch,
  FolderPlus,
  History,
  Layers,
  LayoutTemplate,
  Plus,
  Search,
  Settings2,
  SquareTerminal,
  Terminal as TerminalIcon,
} from "lucide-react";

interface Action {
  id: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
}

export function CommandPalette({
  onClose,
  onOpenSettings,
  onOpenFileFinder,
}: {
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenFileFinder: () => void;
}) {
  const store = useWorkspaceStore();
  const workspace = store.getActiveWorkspace();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const actions = useMemo<Action[]>(() => {
    const list: Action[] = [];

    list.push({
      id: "new-terminal",
      label: "New Terminal",
      hint: "in current workspace",
      icon: <Plus size={14} />,
      run: () => store.addPane(),
    });

    if (store.closedPanes.length > 0) {
      list.push({
        id: "reopen-pane",
        label: "Reopen Last Closed Pane",
        icon: <History size={14} />,
        run: () => store.reopenLastPane(),
      });
    }

    list.push({
      id: "new-workspace",
      label: "New Workspace",
      icon: <Layers size={14} />,
      run: () => store.addWorkspace(),
    });

    list.push({
      id: "add-project",
      label: "Add Project…",
      hint: "choose a folder",
      icon: <FolderPlus size={14} />,
      run: () => {
        pickDirectory().then((path) => {
          if (path) store.addProject(path);
        });
      },
    });

    list.push({
      id: "open-settings",
      label: "Open Settings",
      icon: <Settings2 size={14} />,
      run: onOpenSettings,
    });

    for (const w of store.workspaces) {
      if (w.id === workspace?.id) continue;
      list.push({
        id: `switch-ws-${w.id}`,
        label: `Switch to Workspace: ${w.name}`,
        icon: <Layers size={14} />,
        run: () => store.setActiveWorkspace(w.id),
      });
    }

    if (workspace) {
      const gridPanes = workspace.panes.filter((p) => !p.overlay);
      gridPanes.forEach((p, i) => {
        if (!p.sessionId || p.sessionId === workspace.activeTerminalId) return;
        list.push({
          id: `jump-pane-${p.id}`,
          label: `Jump to ${p.title ?? `Terminal ${i + 1}`}`,
          icon: <TerminalIcon size={14} />,
          run: () => store.setActiveTerminal(p.sessionId!),
        });
      });

      const project = workspace.projects.find((pr) => pr.id === workspace.activeProjectId);
      if (project) {
        list.push({
          id: "open-lazygit",
          label: `Open lazygit — ${project.root.split(/[\\/]/).filter(Boolean).pop()}`,
          icon: <SquareTerminal size={14} />,
          run: () =>
            store.addOverlayPane(
              `lazygit -p ${quotedShell(project.root)}`,
              "lazygit",
              workspace.id,
            ),
        });
        list.push({
          id: "go-to-file",
          label: "Go to File…",
          hint: "⌘P",
          icon: <FileSearch size={14} />,
          run: onOpenFileFinder,
        });
      }
    }

    for (const t of store.templates) {
      list.push({
        id: `template-${t.id}`,
        label: `New Workspace from Template: ${t.name}`,
        icon: <LayoutTemplate size={14} />,
        run: () => store.createWorkspaceFromTemplate(t.id),
      });
    }

    return list;
  }, [store, workspace, onOpenSettings, onOpenFileFinder]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) => a.label.toLowerCase().includes(q));
  }, [actions, query]);

  const runAction = (action: Action) => {
    action.run();
    onClose();
  };

  return (
    <div
      className="absolute inset-0 z-40 flex items-start justify-center pt-24 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-[420px] max-h-[60%] flex flex-col rounded-2xl border border-white/15 bg-[#1d1811]/90 backdrop-blur-xl shadow-2xl shadow-black/60 ring-1 ring-accent/10 animate-slide-up overflow-hidden"
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
                const action = filtered[selected];
                if (action) runAction(action);
              }
            }}
            placeholder="Type a command…"
            spellCheck={false}
            className="flex-1 bg-transparent text-sm text-[#f3e9d8] placeholder:text-[#6f6455] outline-none"
          />
        </div>

        <div className="flex-1 min-h-0 overflow-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-[#8a7c68]">
              No matching commands
            </div>
          ) : (
            filtered.map((action, i) => (
              <div
                key={action.id}
                onMouseEnter={() => setSelected(i)}
                onClick={() => runAction(action)}
                className={`flex items-center gap-2.5 px-3.5 py-2 mx-1 rounded-lg cursor-pointer text-xs transition-colors ${
                  i === selected
                    ? "bg-accent/10 text-accent"
                    : "text-[#d9cbb5] hover:bg-[#2a2318]/60"
                }`}
              >
                <span className={i === selected ? "text-accent" : "text-[#8a7c68]"}>
                  {action.icon}
                </span>
                <span className="truncate flex-1">{action.label}</span>
                {action.hint && (
                  <span className="text-[10px] text-[#8a7c68] shrink-0">{action.hint}</span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
