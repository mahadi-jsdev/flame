import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface AppSettings {
  fontSize: number;
  cursorStyle: "bar" | "block" | "underline";
  cursorBlink: boolean;
  scrollback: number;
  commitModel: string;
  notifications: boolean;
  restoreSession: boolean;
  theme: string;
  sidebarCollapsed: boolean;
}

export const defaultSettings: AppSettings = {
  fontSize: 14,
  cursorStyle: "bar",
  cursorBlink: true,
  scrollback: 100000,
  commitModel: "gpt-4o-mini",
  notifications: true,
  restoreSession: true,
  theme: "flightdeck",
  sidebarCollapsed: false,
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
  color?: string;
  /** Ephemeral: true while output is actively streaming. Not meaningful
   * across restarts — reset to false whenever a persisted session is
   * restored, since there is no live process to reflect anymore. */
  running?: boolean;
  /** Which project this pane belongs to. `undefined` means the pane is
   * unscoped and only shows when no project is active — new panes are
   * stamped with whichever project is active at creation time. */
  projectId?: string;
}

export interface Workspace {
  id: string;
  name: string;
  projects: Project[];
  activeProjectId: string | null;
  panes: Pane[];
  activeTerminalId: string | null;
}

export interface WorkspaceTemplate {
  id: string;
  name: string;
  projects: { root: string }[];
  panes: {
    cwd?: string;
    startupCommand?: string;
    title?: string;
    color?: string;
    /** Root of the project this pane belonged to, re-resolved against the
     * new workspace's freshly-generated project ids on launch. */
    projectRoot?: string;
  }[];
}

/** Panes visible for a given project (or the unscoped pool when `projectId`
 * is null) — the same scoping rule applies to templates, keyboard nav, and
 * the main grid so a project's terminals stay consistent everywhere. */
export function panesForProject(workspace: Workspace, projectId: string | null): Pane[] {
  return workspace.panes.filter(
    (p) => !p.overlay && (p.projectId ?? null) === (projectId ?? null),
  );
}

interface ClosedPane {
  pane: Pane;
  workspaceId: string;
}

export interface TodoItem {
  id: string;
  text: string;
  tag?: string;
  done: boolean;
  createdAt: number;
}

interface WorkspaceState {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  settings: AppSettings;
  templates: WorkspaceTemplate[];
  closedPanes: ClosedPane[];
  updateSettings: (patch: Partial<AppSettings>) => void;

  todos: TodoItem[];
  addTodo: (raw: string) => void;
  toggleTodo: (id: string) => void;
  removeTodo: (id: string) => void;

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
  reopenLastPane: () => void;
  clearPaneStartupCommand: (paneId: string, workspaceId?: string) => void;
  setSessionId: (paneId: string, sessionId: string, shell?: string, cwd?: string, workspaceId?: string) => void;
  setActiveTerminal: (sessionId: string, workspaceId?: string) => void;
  renamePane: (paneId: string, title: string | undefined, workspaceId?: string) => void;
  setPaneColor: (paneId: string, color: string | undefined, workspaceId?: string) => void;
  setPaneRunning: (paneId: string, running: boolean, workspaceId?: string) => void;

  saveWorkspaceTemplate: (workspaceId: string, name: string) => void;
  createWorkspaceFromTemplate: (templateId: string) => void;
  removeWorkspaceTemplate: (id: string) => void;

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
      templates: [],
      closedPanes: [],

      settings: defaultSettings,
      updateSettings: (patch) =>
        set((state) => ({ settings: { ...state.settings, ...patch } })),

      todos: [],
      addTodo: (raw) => {
        const trimmed = raw.trim();
        if (!trimmed) return;
        const tags = [...trimmed.matchAll(/#(\S+)/g)];
        const tag = tags.length > 0 ? tags[tags.length - 1][1] : undefined;
        const text = trimmed.replace(/#\S+/g, "").replace(/\s+/g, " ").trim();
        if (!text) return;
        set((state) => ({
          todos: [
            { id: newId(), text, tag, done: false, createdAt: Date.now() },
            ...state.todos,
          ],
        }));
      },
      toggleTodo: (id) => {
        set((state) => ({
          todos: state.todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
        }));
      },
      removeTodo: (id) => {
        set((state) => ({ todos: state.todos.filter((t) => t.id !== id) }));
      },

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
                  panes: [...w.panes, { id: newId(), type: "terminal" as const, projectId: project.id }],
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
            workspaces: state.workspaces.map((w) => {
              if (w.id !== id) return w;
              const hasPane = panesForProject(w, projectId).length > 0;
              const panes = hasPane
                ? w.panes
                : [...w.panes, { id: newId(), type: "terminal" as const, projectId }];
              return { ...w, activeProjectId: projectId, panes };
            }),
          };
        });
      },

      addPane: (workspaceId, startupCommand) => {
        set((state) => {
          const id = workspaceId ?? state.activeWorkspaceId ?? state.workspaces[0]?.id;
          if (!id) return state;
          const workspace = state.workspaces.find((w) => w.id === id);
          const pane: Pane = {
            id: newId(),
            type: "terminal" as const,
            startupCommand,
            projectId: workspace?.activeProjectId ?? undefined,
          };
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
          let closedPanes = state.closedPanes;
          const workspaces = state.workspaces.map((w) => {
            if (w.id !== id) return w;
            const removed = w.panes.find((p) => p.id === paneId);
            if (removed && !removed.overlay) {
              closedPanes = [{ pane: removed, workspaceId: id }, ...closedPanes].slice(0, 5);
            }
            const remaining = w.panes.filter((p) => p.id !== paneId);
            const panes = remaining.length > 0 ? remaining : [{ id: newId(), type: "terminal" as const }];
            const activeTerminalId =
              removed?.sessionId && removed.sessionId === w.activeTerminalId
                ? null
                : w.activeTerminalId;
            return { ...w, panes, activeTerminalId };
          });
          return { workspaces, closedPanes };
        });
      },

      reopenLastPane: () => {
        set((state) => {
          if (state.closedPanes.length === 0) return state;
          const [{ pane, workspaceId }, ...rest] = state.closedPanes;
          const id = state.workspaces.some((w) => w.id === workspaceId)
            ? workspaceId
            : state.activeWorkspaceId ?? state.workspaces[0]?.id;
          if (!id) return { closedPanes: rest };
          const newPane: Pane = {
            ...pane,
            id: newId(),
            sessionId: undefined,
            running: false,
          };
          return {
            closedPanes: rest,
            workspaces: state.workspaces.map((w) =>
              w.id === id ? { ...w, panes: [...w.panes, newPane] } : w
            ),
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

      renamePane: (paneId, title, workspaceId) => {
        set((state) => {
          const id = workspaceId ?? state.activeWorkspaceId ?? state.workspaces[0]?.id;
          if (!id) return state;
          return {
            workspaces: state.workspaces.map((w) =>
              w.id === id
                ? {
                  ...w,
                  panes: w.panes.map((p) =>
                    p.id === paneId ? { ...p, title } : p
                  ),
                }
                : w
            ),
          };
        });
      },

      setPaneColor: (paneId, color, workspaceId) => {
        set((state) => {
          const id = workspaceId ?? state.activeWorkspaceId ?? state.workspaces[0]?.id;
          if (!id) return state;
          return {
            workspaces: state.workspaces.map((w) =>
              w.id === id
                ? {
                  ...w,
                  panes: w.panes.map((p) =>
                    p.id === paneId ? { ...p, color } : p
                  ),
                }
                : w
            ),
          };
        });
      },

      setPaneRunning: (paneId, running, workspaceId) => {
        set((state) => {
          const id = workspaceId ?? state.activeWorkspaceId ?? state.workspaces[0]?.id;
          if (!id) return state;
          return {
            workspaces: state.workspaces.map((w) =>
              w.id === id
                ? {
                  ...w,
                  panes: w.panes.map((p) =>
                    p.id === paneId ? { ...p, running } : p
                  ),
                }
                : w
            ),
          };
        });
      },

      saveWorkspaceTemplate: (workspaceId, name) => {
        set((state) => {
          const w = state.workspaces.find((w) => w.id === workspaceId);
          if (!w) return state;
          const template: WorkspaceTemplate = {
            id: newId(),
            name,
            projects: w.projects.map((p) => ({ root: p.root })),
            panes: w.panes
              .filter((p) => !p.overlay)
              .map((p) => ({
                cwd: p.cwd,
                startupCommand: p.startupCommand,
                title: p.title,
                color: p.color,
                projectRoot: w.projects.find((pr) => pr.id === p.projectId)?.root,
              })),
          };
          return { templates: [...state.templates, template] };
        });
      },

      createWorkspaceFromTemplate: (templateId) => {
        set((state) => {
          const template = state.templates.find((t) => t.id === templateId);
          if (!template) return state;
          const projects = template.projects.map((p) => ({ id: newId(), root: p.root }));
          const rootToNewId = new Map(projects.map((p) => [p.root, p.id]));
          const panes: Pane[] =
            template.panes.length > 0
              ? template.panes.map((p) => ({
                id: newId(),
                type: "terminal" as const,
                cwd: p.cwd,
                startupCommand: p.startupCommand,
                title: p.title,
                color: p.color,
                projectId: p.projectRoot ? rootToNewId.get(p.projectRoot) : undefined,
              }))
              : [{ id: newId(), type: "terminal" as const }];
          const nextIndex = state.workspaces.length + 1;
          const workspace: Workspace = {
            id: newId(),
            name: template.name || defaultWorkspaceName(nextIndex),
            projects,
            activeProjectId: projects[0]?.id ?? null,
            panes,
            activeTerminalId: null,
          };
          return {
            workspaces: [...state.workspaces, workspace],
            activeWorkspaceId: workspace.id,
          };
        });
      },

      removeWorkspaceTemplate: (id) => {
        set((state) => ({ templates: state.templates.filter((t) => t.id !== id) }));
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
      partialize: (s) => ({
        settings: s.settings,
        workspaces: s.workspaces,
        activeWorkspaceId: s.activeWorkspaceId,
        templates: s.templates,
        todos: s.todos,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<WorkspaceState>;
        const settings = { ...defaultSettings, ...p.settings };
        const templates = p.templates ?? [];
        const todos = p.todos ?? [];

        if (!settings.restoreSession || !p.workspaces || p.workspaces.length === 0) {
          return { ...current, settings, templates, todos };
        }

        const workspaces = p.workspaces.map((w) => {
          const panes = w.panes
            .filter((pane) => !pane.overlay)
            .map((pane) => {
              // Migrate panes saved before per-project scoping existed: infer
              // which project a pane belonged to from where it was spawned,
              // falling back to whatever project was active at save time.
              const projectId =
                pane.projectId ??
                w.projects.find((pr) => pane.cwd && pane.cwd.startsWith(pr.root))?.id ??
                w.activeProjectId ??
                undefined;
              return { ...pane, sessionId: undefined, running: false, projectId };
            });
          return {
            ...w,
            activeTerminalId: null,
            panes: panes.length > 0 ? panes : [{ id: newId(), type: "terminal" as const }],
          };
        });

        return {
          ...current,
          settings,
          templates,
          todos,
          workspaces,
          activeWorkspaceId: p.activeWorkspaceId ?? null,
        };
      },
    },
  ),
);
