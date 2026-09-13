import { create } from "zustand";

export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

interface WorkspaceState {
  root: string | null;
  entries: DirEntry[];
  setRoot: (root: string, entries: DirEntry[]) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  root: null,
  entries: [],
  setRoot: (root, entries) => set({ root, entries }),
}));
