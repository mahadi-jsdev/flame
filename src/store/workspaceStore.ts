import { create } from "zustand";

export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export type PaneType = "terminal" | "chat" | "browser";

export interface Pane {
  id: string;
  type: PaneType;
  sessionId?: string;
}

interface WorkspaceState {
  root: string | null;
  entries: DirEntry[];
  panes: Pane[];
  activeTerminalId: string | null;
  setRoot: (root: string, entries: DirEntry[]) => void;
  addPane: (type: PaneType) => void;
  removePane: (id: string) => void;
  setSessionId: (paneId: string, sessionId: string) => void;
  setActiveTerminal: (id: string) => void;
}

function newId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  root: null,
  entries: [],
  panes: [{ id: newId(), type: "terminal" }],
  activeTerminalId: null,
  setRoot: (root, entries) => set({ root, entries }),
  addPane: (type) =>
    set((state) => ({
      panes: [...state.panes, { id: newId(), type }],
    })),
  removePane: (id) =>
    set((state) => ({
      panes: state.panes.filter((p) => p.id !== id),
    })),
  setSessionId: (paneId, sessionId) =>
    set((state) => ({
      panes: state.panes.map((p) =>
        p.id === paneId ? { ...p, sessionId } : p
      ),
    })),
  setActiveTerminal: (id) => set({ activeTerminalId: id }),
}));
