import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface AppSettings {
  fontSize: number;
  cursorStyle: "bar" | "block" | "underline";
  cursorBlink: boolean;
  scrollback: number;
  diffViewer: "auto" | "delta" | "diff-so-fancy" | "plain";
  openaiApiKey: string;
  commitModel: string;
}

export const defaultSettings: AppSettings = {
  fontSize: 14,
  cursorStyle: "bar",
  cursorBlink: true,
  scrollback: 100000,
  diffViewer: "auto",
  openaiApiKey: "",
  commitModel: "gpt-4o-mini",
};

export interface Project {
  id: string;
  root: string;
}

export type PaneType = "terminal";

export interface Pane {
  id: string;
  type: PaneType;
  sessionId?: string;
  shell?: string;
  cwd?: string;
  startupCommand?: string;
  overlay?: boolean;
  title?: string;
}

export interface Workspace {
  id: string;
  name: string;
  projects: Project[];
  activeProjectId: string | null;
  panes: Pane[];
  activeTerminalId: string | null;
}

interface WorkspaceState {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;

  getActiveWorkspace: () => Workspace | undefined;

  addWorkspace: (name?: string) => void;
  removeWorkspace: (id: string) => void;
  setActiveWorkspace: (id: string) => void;
  renameWorkspace: (id: string, name: string) => void;

  addProject: (root: string, workspaceId?: string) => void;
  removeProject: (projectId: string, workspaceId?: string) => void;
  setActiveProject: (projectId: string, workspaceId?: string) => void;

  addPane: (workspaceId?: string, startupCommand?: string) => void;
  addOverlayPane: (command: string, title: string, workspaceId?: string) => void;
  swapPanes: (aId: string, bId: string, workspaceId?: string) => void;
  removePane: (paneId: string, workspaceId?: string) => void;
  clearPaneStartupCommand: (paneId: string, workspaceId?: string) => void;
  setSessionId: (paneId: string, sessionId: string, shell?: string, cwd?: string, workspaceId?: string) => void;
  setActiveTerminal: (sessionId: string, workspaceId?: string) => void;

  activeCwd: () => string | undefined;
}

function newId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function defaultWorkspaceName(index: number) {
  return `Workspace ${index}`;
}

function createWorkspace(name: string): Workspace {
  return {
    id: newId(),
    name,
    projects: [],
    activeProjectId: null,
    panes: [{ id: newId(), type: "terminal" }],
    activeTerminalId: null,
  };
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      workspaces: [createWorkspace(defaultWorkspaceName(1))],
      activeWorkspaceId: null,

      settings: defaultSettings,
      updateSettings: (patch) =>
        set((state) => ({ settings: { ...state.settings, ...patch } })),

      getActiveWorkspace: () => {
        const { workspaces, activeWorkspaceId } = get();
        if (!activeWorkspaceId) return workspaces[0];
        return workspaces.find((w) => w.id === activeWorkspaceId);
      },

      addWorkspace: (name) => {
        set((state) => {
          const nextIndex = state.workspaces.length + 1;
          const workspace = createWorkspace(name ?? defaultWorkspaceName(nextIndex));
          return {
            workspaces: [...state.workspaces, workspace],
            activeWorkspaceId: workspace.id,
          };
        });
      },

      removeWorkspace: (id) => {
        set((state) => {
          const remaining = state.workspaces.filter((w) => w.id !== id);
          if (remaining.length === 0) {
            const workspace = createWorkspace(defaultWorkspaceName(1));
            return {
              workspaces: [workspace],
              activeWorkspaceId: workspace.id,
            };
          }

          let activeWorkspaceId = state.activeWorkspaceId;
          if (activeWorkspaceId === id || !activeWorkspaceId) {
            activeWorkspaceId = remaining[0].id;
          }
          return { workspaces: remaining, activeWorkspaceId };
        });
      },

      setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),

      renameWorkspace: (id, name) => {
        set((state) => ({
          workspaces: state.workspaces.map((w) =>
            w.id === id ? { ...w, name } : w
          ),
        }));
      },

      addProject: (root, workspaceId) => {
        set((state) => {
          const id = workspaceId ?? state.activeWorkspaceId ?? state.workspaces[0]?.id;
          if (!id) return state;
          const project = { id: newId(), root };
          return {
            workspaces: state.workspaces.map((w) =>
              w.id === id
                ? {
                  ...w,
                  projects: [...w.projects, project],
                  activeProjectId: project.id,
                }
                : w
            ),
          };
        });
      },

      removeProject: (projectId, workspaceId) => {
        set((state) => {
          const id = workspaceId ?? state.activeWorkspaceId ?? state.workspaces[0]?.id;
          if (!id) return state;
          return {
            workspaces: state.workspaces.map((w) => {
              if (w.id !== id) return w;
              const projects = w.projects.filter((p) => p.id !== projectId);
              const activeProjectId =
                w.activeProjectId === projectId
                  ? projects[0]?.id ?? null
                  : w.activeProjectId;
              return { ...w, projects, activeProjectId };
            }),
          };
        });
      },

      setActiveProject: (projectId, workspaceId) => {
        set((state) => {
          const id = workspaceId ?? state.activeWorkspaceId ?? state.workspaces[0]?.id;
          if (!id) return state;
          return {
            workspaces: state.workspaces.map((w) =>
              w.id === id ? { ...w, activeProjectId: projectId } : w
            ),
          };
        });
      },

      addPane: (workspaceId, startupCommand) => {
        set((state) => {
          const id = workspaceId ?? state.activeWorkspaceId ?? state.workspaces[0]?.id;
          if (!id) return state;
          const pane: Pane = { id: newId(), type: "terminal" as const, startupCommand };
          return {
            workspaces: state.workspaces.map((w) =>
              w.id === id ? { ...w, panes: [...w.panes, pane] } : w
            ),
          };
        });
      },

      addOverlayPane: (command, title, workspaceId) => {
        set((state) => {
          const id = workspaceId ?? state.activeWorkspaceId ?? state.workspaces[0]?.id;
          if (!id) return state;
          const pane: Pane = {
            id: newId(),
            type: "terminal" as const,
            startupCommand: command,
            overlay: true,
            title,
          };
          return {
            workspaces: state.workspaces.map((w) =>
              w.id === id
                ? { ...w, panes: [...w.panes.filter((p) => !p.overlay), pane] }
                : w
            ),
          };
        });
      },

      swapPanes: (aId, bId, workspaceId) => {
        set((state) => {
          const id = workspaceId ?? state.activeWorkspaceId ?? state.workspaces[0]?.id;
          if (!id) return state;
          return {
            workspaces: state.workspaces.map((w) => {
              if (w.id !== id) return w;
              const i = w.panes.findIndex((p) => p.id === aId);
              const j = w.panes.findIndex((p) => p.id === bId);
              if (i === -1 || j === -1 || i === j) return w;
              const panes = [...w.panes];
              [panes[i], panes[j]] = [panes[j], panes[i]];
              return { ...w, panes };
            }),
          };
        });
      },

      clearPaneStartupCommand: (paneId, workspaceId) => {
        set((state) => {
          const id = workspaceId ?? state.activeWorkspaceId ?? state.workspaces[0]?.id;
          if (!id) return state;
          return {
            workspaces: state.workspaces.map((w) =>
              w.id === id
                ? {
                  ...w,
                  panes: w.panes.map((p) =>
                    p.id === paneId ? { ...p, startupCommand: undefined } : p
                  ),
                }
                : w
            ),
          };
        });
      },

      removePane: (paneId, workspaceId) => {
        set((state) => {
          const id = workspaceId ?? state.activeWorkspaceId ?? state.workspaces[0]?.id;
          if (!id) return state;
          return {
            workspaces: state.workspaces.map((w) => {
              if (w.id !== id) return w;
              const removed = w.panes.find((p) => p.id === paneId);
              const remaining = w.panes.filter((p) => p.id !== paneId);
              const panes = remaining.length > 0 ? remaining : [{ id: newId(), type: "terminal" as const }];
              const activeTerminalId =
                removed?.sessionId && removed.sessionId === w.activeTerminalId
                  ? null
                  : w.activeTerminalId;
              return { ...w, panes, activeTerminalId };
            }),
          };
        });
      },

      setSessionId: (paneId, sessionId, shell, cwd, workspaceId) => {
        set((state) => {
          const id = workspaceId ?? state.activeWorkspaceId ?? state.workspaces[0]?.id;
          if (!id) return state;
          return {
            workspaces: state.workspaces.map((w) =>
              w.id === id
                ? {
                  ...w,
                  panes: w.panes.map((p) =>
                    p.id === paneId ? { ...p, sessionId, shell, cwd } : p
                  ),
                }
                : w
            ),
          };
        });
      },

      setActiveTerminal: (sessionId, workspaceId) => {
        set((state) => {
          const id = workspaceId ?? state.activeWorkspaceId ?? state.workspaces[0]?.id;
          if (!id) return state;
          return {
            workspaces: state.workspaces.map((w) =>
              w.id === id ? { ...w, activeTerminalId: sessionId } : w
            ),
          };
        });
      },

      activeCwd: () => {
        const workspace = get().getActiveWorkspace();
        if (!workspace) return undefined;
        const project = workspace.projects.find((p) => p.id === workspace.activeProjectId);
        return project?.root;
      },
    }),
    {
      name: "ai-terminal-agent-settings",
      partialize: (s) => ({ settings: s.settings }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<WorkspaceState>;
        return {
          ...current,
          ...p,
          settings: { ...defaultSettings, ...p.settings },
        };
      },
    },
  ),
);
