# Remove Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the `Workspace` concept from Flame entirely; `Project` becomes the top-level unit, owning its panes directly, with the sidebar showing a single "Projects" list in place of today's "Workspaces" + separate bottom "Projects" sections.

**Architecture:** One atomic data-model change (`store/workspaceStore.ts` → `store/projectStore.ts`) that every UI component depends on directly (`useWorkspaceStore`/`Workspace` type/`panesForProject`), so Tasks 2-6 cannot individually typecheck or pass the *full* suite until all land — each task's own scoped test file is what verifies that task in isolation. Full `tsc --noEmit` + `vitest run` only goes green after Task 6.

**Tech Stack:** React 19, Zustand (`persist` middleware), TypeScript, Vitest + Testing Library.

**Spec:** [docs/superpowers/specs/2026-09-17-remove-workspace-design.md](../specs/2026-09-17-remove-workspace-design.md)

## Global Constraints

- No custom project rename UI — display name is always `projectName(root)` (last path segment), already exported from `src/lib/gitUtils.ts`.
- Workspace templates are deleted, not migrated.
- Unscoped panes (no `projectId` in old data) are dropped, not migrated.
- `removeProject` may reduce the project list to zero — that is the normal path into the new empty state, not an error case.
- Every pane-mutating store action keeps its current "optional target id, defaults to the active one" parameter shape, renamed `workspaceId` → `projectId`.

---

## Task 1: Rewrite the store

**Files:**
- Create: `src/store/projectStore.ts` (replaces `src/store/workspaceStore.ts`, which is deleted)
- Create: `src/store/projectStore.test.ts` (replaces `src/store/workspaceStore.test.ts`, which is deleted)

**Interfaces:**
- Produces: `Project { id: string; root: string; panes: Pane[]; activeTerminalId: string | null }`, `Pane` (same fields as today minus `projectId`), `useProjectStore` (Zustand hook) exposing `projects: Project[]`, `activeProjectId: string | null`, `settings: AppSettings`, `closedPanes: { pane: Pane; projectId: string }[]`, and the actions listed below. `AppSettings`/`defaultSettings` are unchanged (copy verbatim from the current file).

- [ ] **Step 1: Write the failing test file for the new store shape**

Create `src/store/projectStore.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "./projectStore";

function reset() {
  localStorage.clear();
  useProjectStore.setState({
    projects: [],
    activeProjectId: null,
    settings: useProjectStore.getState().settings,
    closedPanes: [],
  });
}

beforeEach(reset);

describe("projectStore basics", () => {
  it("starts with zero projects", () => {
    expect(useProjectStore.getState().projects).toEqual([]);
    expect(useProjectStore.getState().getActiveProject()).toBeUndefined();
  });

  it("addProject creates a project with one blank pane and makes it active", () => {
    useProjectStore.getState().addProject("/repo/a");
    const { projects, activeProjectId } = useProjectStore.getState();
    expect(projects).toHaveLength(1);
    expect(projects[0].root).toBe("/repo/a");
    expect(projects[0].panes).toHaveLength(1);
    expect(activeProjectId).toBe(projects[0].id);
  });

  it("removeProject can reduce the list to zero", () => {
    useProjectStore.getState().addProject("/repo/a");
    const id = useProjectStore.getState().projects[0].id;
    useProjectStore.getState().removeProject(id);
    expect(useProjectStore.getState().projects).toEqual([]);
    expect(useProjectStore.getState().activeProjectId).toBeNull();
  });

  it("removeProject falls back to the first remaining project when the active one is removed", () => {
    useProjectStore.getState().addProject("/repo/a");
    useProjectStore.getState().addProject("/repo/b");
    const [a, b] = useProjectStore.getState().projects;
    useProjectStore.getState().setActiveProject(a.id);
    useProjectStore.getState().removeProject(a.id);
    expect(useProjectStore.getState().projects).toEqual([b]);
    expect(useProjectStore.getState().activeProjectId).toBe(b.id);
  });

  it("setActiveProject switches the active project", () => {
    useProjectStore.getState().addProject("/repo/a");
    useProjectStore.getState().addProject("/repo/b");
    const [a] = useProjectStore.getState().projects;
    useProjectStore.getState().setActiveProject(a.id);
    expect(useProjectStore.getState().activeProjectId).toBe(a.id);
  });
});

describe("projectStore pane actions", () => {
  beforeEach(() => {
    useProjectStore.getState().addProject("/repo/a");
  });

  it("addPane appends a pane to the active project by default", () => {
    useProjectStore.getState().addPane();
    expect(useProjectStore.getState().projects[0].panes).toHaveLength(2);
  });

  it("addPane accepts an explicit projectId, not just the active one", () => {
    useProjectStore.getState().addProject("/repo/b");
    const [a] = useProjectStore.getState().projects;
    useProjectStore.getState().addPane(a.id);
    const refreshed = useProjectStore.getState().projects.find((p) => p.id === a.id)!;
    expect(refreshed.panes).toHaveLength(2);
  });

  it("removePane keeps at least one pane, replacing the last one removed", () => {
    const paneId = useProjectStore.getState().projects[0].panes[0].id;
    useProjectStore.getState().removePane(paneId);
    const panes = useProjectStore.getState().projects[0].panes;
    expect(panes).toHaveLength(1);
    expect(panes[0].id).not.toBe(paneId);
  });

  it("removePane records a closedPane scoped to its project, and reopenLastPane restores it", () => {
    const project = useProjectStore.getState().projects[0];
    useProjectStore.getState().addPane(project.id, "npm run dev");
    const added = useProjectStore.getState().projects[0].panes[1];
    useProjectStore.getState().removePane(added.id);
    expect(useProjectStore.getState().closedPanes[0].projectId).toBe(project.id);
    useProjectStore.getState().reopenLastPane();
    const panes = useProjectStore.getState().projects[0].panes;
    expect(panes.some((p) => p.startupCommand === "npm run dev")).toBe(true);
  });

  it("setPaneColor/renamePane/setPaneRunning/setPaneWaiting/setPaneBackgrounded target a pane by id", () => {
    const paneId = useProjectStore.getState().projects[0].panes[0].id;
    const s = useProjectStore.getState();
    s.renamePane(paneId, "claude");
    s.setPaneColor(paneId, "#ffb238");
    s.setPaneRunning(paneId, true);
    s.setPaneWaiting(paneId, true);
    s.setPaneBackgrounded(paneId, true);
    const pane = useProjectStore.getState().projects[0].panes[0];
    expect(pane).toMatchObject({
      title: "claude",
      color: "#ffb238",
      waitingForInput: true,
      backgrounded: true,
    });
  });

  it("activeCwd returns the active project's root", () => {
    expect(useProjectStore.getState().activeCwd()).toBe("/repo/a");
  });
});

describe("projectStore migration from the old workspace-shaped persisted data", () => {
  it("flattens each workspace's projects into top-level projects, dropping unscoped panes and templates", async () => {
    localStorage.setItem(
      "ai-terminal-agent-settings",
      JSON.stringify({
        state: {
          settings: { restoreSession: true },
          templates: [{ id: "t1", name: "old template", projects: [], panes: [] }],
          activeWorkspaceId: "w2",
          workspaces: [
            {
              id: "w1",
              name: "Workspace 1",
              activeProjectId: "pr1",
              projects: [{ id: "pr1", root: "/repo/a" }],
              panes: [
                { id: "p1", type: "terminal", projectId: "pr1", title: "claude" },
                { id: "p2", type: "terminal" }, // unscoped — dropped
              ],
              activeTerminalId: null,
            },
            {
              id: "w2",
              name: "Workspace 2",
              activeProjectId: "pr2",
              projects: [{ id: "pr2", root: "/repo/b" }],
              panes: [{ id: "p3", type: "terminal", projectId: "pr2" }],
              activeTerminalId: null,
            },
          ],
        },
        version: 0,
      }),
    );
    // vi.resetModules() + a fresh dynamic import re-runs the persist
    // middleware's hydration against the localStorage value just written
    // above — the same technique the current workspaceStore.test.ts already
    // uses for its own migration tests.
    vi.resetModules();
    const mod = await import("./projectStore");
    const state = mod.useProjectStore.getState();
    expect(state.projects).toHaveLength(2);
    const a = state.projects.find((p) => p.root === "/repo/a")!;
    expect(a.panes).toHaveLength(1);
    expect(a.panes[0].title).toBe("claude");
    expect((a.panes[0] as { projectId?: string }).projectId).toBeUndefined();
    const b = state.projects.find((p) => p.root === "/repo/b")!;
    expect(b.panes).toHaveLength(1);
    expect(state.activeProjectId).toBe("pr2");
    expect((state as unknown as { templates?: unknown }).templates).toBeUndefined();
  });

  it("skips restoring when restoreSession is false, landing on the empty state", async () => {
    localStorage.setItem(
      "ai-terminal-agent-settings",
      JSON.stringify({
        state: {
          settings: { restoreSession: false },
          workspaces: [
            {
              id: "w1",
              name: "W",
              activeProjectId: null,
              projects: [{ id: "pr1", root: "/repo/a" }],
              panes: [],
              activeTerminalId: null,
            },
          ],
        },
        version: 0,
      }),
    );
    vi.resetModules();
    const mod = await import("./projectStore");
    expect(mod.useProjectStore.getState().projects).toEqual([]);
    expect(mod.useProjectStore.getState().activeProjectId).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails (module doesn't exist yet)**

Run: `npx vitest run src/store/projectStore.test.ts`
Expected: FAIL — `Cannot find module './projectStore'`

- [ ] **Step 3: Write `src/store/projectStore.ts`**

```ts
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
  gitPanelCollapsed: boolean;
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
  gitPanelCollapsed: false,
};

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
  /** Ephemeral: true when output has gone quiet right after something that
   * looks like a yes/no or permission prompt — the agent is likely blocked
   * on the user. Same restart-reset rule as `running`. */
  waitingForInput?: boolean;
  /** Sent to the background by the user: still mounted (PTY stays alive)
   * but excluded from the grid until brought back to the foreground. */
  backgrounded?: boolean;
}

export interface Project {
  id: string;
  root: string;
  panes: Pane[];
  activeTerminalId: string | null;
}

interface ClosedPane {
  pane: Pane;
  projectId: string;
}

interface ProjectState {
  projects: Project[];
  activeProjectId: string | null;
  settings: AppSettings;
  closedPanes: ClosedPane[];
  updateSettings: (patch: Partial<AppSettings>) => void;

  getActiveProject: () => Project | undefined;

  addProject: (root: string) => void;
  removeProject: (id: string) => void;
  setActiveProject: (id: string) => void;

  addPane: (projectId?: string, startupCommand?: string) => void;
  addOverlayPane: (command: string, title: string, projectId?: string) => void;
  swapPanes: (aId: string, bId: string, projectId?: string) => void;
  removePane: (paneId: string, projectId?: string) => void;
  reopenLastPane: () => void;
  clearPaneStartupCommand: (paneId: string, projectId?: string) => void;
  setSessionId: (paneId: string, sessionId: string, shell?: string, cwd?: string, projectId?: string) => void;
  setActiveTerminal: (sessionId: string, projectId?: string) => void;
  renamePane: (paneId: string, title: string | undefined, projectId?: string) => void;
  setPaneColor: (paneId: string, color: string | undefined, projectId?: string) => void;
  setPaneRunning: (paneId: string, running: boolean, projectId?: string) => void;
  setPaneWaiting: (paneId: string, waiting: boolean, projectId?: string) => void;
  setPaneBackgrounded: (paneId: string, backgrounded: boolean, projectId?: string) => void;

  activeCwd: () => string | undefined;
}

function newId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createProject(root: string): Project {
  return {
    id: newId(),
    root,
    panes: [{ id: newId(), type: "terminal" }],
    activeTerminalId: null,
  };
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      projects: [],
      activeProjectId: null,
      closedPanes: [],

      settings: defaultSettings,
      updateSettings: (patch) =>
        set((state) => ({ settings: { ...state.settings, ...patch } })),

      getActiveProject: () => {
        const { projects, activeProjectId } = get();
        return projects.find((p) => p.id === activeProjectId);
      },

      addProject: (root) => {
        set((state) => {
          const project = createProject(root);
          return {
            projects: [...state.projects, project],
            activeProjectId: project.id,
          };
        });
      },

      removeProject: (id) => {
        set((state) => {
          const remaining = state.projects.filter((p) => p.id !== id);
          let activeProjectId = state.activeProjectId;
          if (activeProjectId === id) {
            activeProjectId = remaining[0]?.id ?? null;
          }
          return { projects: remaining, activeProjectId };
        });
      },

      setActiveProject: (id) => set({ activeProjectId: id }),

      addPane: (projectId, startupCommand) => {
        set((state) => {
          const id = projectId ?? state.activeProjectId;
          if (!id) return state;
          const pane: Pane = { id: newId(), type: "terminal", startupCommand };
          return {
            projects: state.projects.map((p) =>
              p.id === id ? { ...p, panes: [...p.panes, pane] } : p
            ),
          };
        });
      },

      addOverlayPane: (command, title, projectId) => {
        set((state) => {
          const id = projectId ?? state.activeProjectId;
          if (!id) return state;
          const pane: Pane = {
            id: newId(),
            type: "terminal",
            startupCommand: command,
            overlay: true,
            title,
          };
          return {
            projects: state.projects.map((p) =>
              p.id === id
                ? { ...p, panes: [...p.panes.filter((x) => !x.overlay), pane] }
                : p
            ),
          };
        });
      },

      swapPanes: (aId, bId, projectId) => {
        set((state) => {
          const id = projectId ?? state.activeProjectId;
          if (!id) return state;
          return {
            projects: state.projects.map((p) => {
              if (p.id !== id) return p;
              const i = p.panes.findIndex((x) => x.id === aId);
              const j = p.panes.findIndex((x) => x.id === bId);
              if (i === -1 || j === -1 || i === j) return p;
              const panes = [...p.panes];
              [panes[i], panes[j]] = [panes[j], panes[i]];
              return { ...p, panes };
            }),
          };
        });
      },

      clearPaneStartupCommand: (paneId, projectId) => {
        set((state) => {
          const id = projectId ?? state.activeProjectId;
          if (!id) return state;
          return {
            projects: state.projects.map((p) =>
              p.id === id
                ? {
                  ...p,
                  panes: p.panes.map((x) =>
                    x.id === paneId ? { ...x, startupCommand: undefined } : x
                  ),
                }
                : p
            ),
          };
        });
      },

      removePane: (paneId, projectId) => {
        set((state) => {
          const id = projectId ?? state.activeProjectId;
          if (!id) return state;
          let closedPanes = state.closedPanes;
          const projects = state.projects.map((p) => {
            if (p.id !== id) return p;
            const removed = p.panes.find((x) => x.id === paneId);
            if (removed && !removed.overlay) {
              closedPanes = [{ pane: removed, projectId: id }, ...closedPanes].slice(0, 5);
            }
            const remaining = p.panes.filter((x) => x.id !== paneId);
            const panes = remaining.length > 0 ? remaining : [{ id: newId(), type: "terminal" as const }];
            const activeTerminalId =
              removed?.sessionId && removed.sessionId === p.activeTerminalId
                ? null
                : p.activeTerminalId;
            return { ...p, panes, activeTerminalId };
          });
          return { projects, closedPanes };
        });
      },

      reopenLastPane: () => {
        set((state) => {
          if (state.closedPanes.length === 0) return state;
          const [{ pane, projectId }, ...rest] = state.closedPanes;
          const id = state.projects.some((p) => p.id === projectId)
            ? projectId
            : state.activeProjectId;
          if (!id) return { closedPanes: rest };
          const newPane: Pane = {
            ...pane,
            id: newId(),
            sessionId: undefined,
            running: false,
            waitingForInput: false,
          };
          return {
            closedPanes: rest,
            projects: state.projects.map((p) =>
              p.id === id ? { ...p, panes: [...p.panes, newPane] } : p
            ),
          };
        });
      },

      setSessionId: (paneId, sessionId, shell, cwd, projectId) => {
        set((state) => {
          const id = projectId ?? state.activeProjectId;
          if (!id) return state;
          return {
            projects: state.projects.map((p) =>
              p.id === id
                ? {
                  ...p,
                  panes: p.panes.map((x) =>
                    x.id === paneId ? { ...x, sessionId, shell, cwd } : x
                  ),
                }
                : p
            ),
          };
        });
      },

      setActiveTerminal: (sessionId, projectId) => {
        set((state) => {
          const id = projectId ?? state.activeProjectId;
          if (!id) return state;
          return {
            projects: state.projects.map((p) =>
              p.id === id ? { ...p, activeTerminalId: sessionId } : p
            ),
          };
        });
      },

      renamePane: (paneId, title, projectId) => {
        set((state) => {
          const id = projectId ?? state.activeProjectId;
          if (!id) return state;
          return {
            projects: state.projects.map((p) =>
              p.id === id
                ? { ...p, panes: p.panes.map((x) => (x.id === paneId ? { ...x, title } : x)) }
                : p
            ),
          };
        });
      },

      setPaneColor: (paneId, color, projectId) => {
        set((state) => {
          const id = projectId ?? state.activeProjectId;
          if (!id) return state;
          return {
            projects: state.projects.map((p) =>
              p.id === id
                ? { ...p, panes: p.panes.map((x) => (x.id === paneId ? { ...x, color } : x)) }
                : p
            ),
          };
        });
      },

      setPaneRunning: (paneId, running, projectId) => {
        set((state) => {
          const id = projectId ?? state.activeProjectId;
          if (!id) return state;
          return {
            projects: state.projects.map((p) =>
              p.id === id
                ? {
                  ...p,
                  panes: p.panes.map((x) =>
                    x.id === paneId
                      ? { ...x, running, waitingForInput: running ? false : x.waitingForInput }
                      : x
                  ),
                }
                : p
            ),
          };
        });
      },

      setPaneWaiting: (paneId, waiting, projectId) => {
        set((state) => {
          const id = projectId ?? state.activeProjectId;
          if (!id) return state;
          return {
            projects: state.projects.map((p) =>
              p.id === id
                ? { ...p, panes: p.panes.map((x) => (x.id === paneId ? { ...x, waitingForInput: waiting } : x)) }
                : p
            ),
          };
        });
      },

      setPaneBackgrounded: (paneId, backgrounded, projectId) => {
        set((state) => {
          const id = projectId ?? state.activeProjectId;
          if (!id) return state;
          return {
            projects: state.projects.map((p) => {
              if (p.id !== id) return p;
              const pane = p.panes.find((x) => x.id === paneId);
              return {
                ...p,
                panes: p.panes.map((x) => (x.id === paneId ? { ...x, backgrounded } : x)),
                activeTerminalId:
                  !backgrounded && pane?.sessionId ? pane.sessionId : p.activeTerminalId,
              };
            }),
          };
        });
      },

      activeCwd: () => get().getActiveProject()?.root,
    }),
    {
      name: "ai-terminal-agent-settings",
      partialize: (s) => ({
        settings: s.settings,
        projects: s.projects,
        activeProjectId: s.activeProjectId,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        const settings = { ...defaultSettings, ...(p.settings as Partial<AppSettings>) };

        if (!settings.restoreSession) {
          return { ...current, settings };
        }

        // Already-new-shape data (post-migration, or a fresh install that
        // never had workspaces): use as-is.
        if (Array.isArray(p.projects)) {
          return {
            ...current,
            settings,
            projects: p.projects as Project[],
            activeProjectId: (p.activeProjectId as string | null) ?? null,
          };
        }

        // Old workspace-shaped data: flatten each workspace's projects into
        // top-level projects, keeping only panes already scoped to one
        // (unscoped panes and workspace templates are intentionally dropped
        // — see the design doc).
        type OldPane = Pane & { projectId?: string };
        type OldProjectRef = { id: string; root: string };
        type OldWorkspace = {
          id: string;
          activeProjectId: string | null;
          projects: OldProjectRef[];
          panes: OldPane[];
        };
        const oldWorkspaces = (p.workspaces as OldWorkspace[] | undefined) ?? [];
        const oldActiveWorkspaceId = p.activeWorkspaceId as string | null | undefined;

        const projects: Project[] = [];
        let activeProjectId: string | null = null;
        for (const w of oldWorkspaces) {
          for (const oldProject of w.projects) {
            const panes: Pane[] = w.panes
              .filter((pane) => pane.projectId === oldProject.id)
              .map((pane) => {
                const { projectId: _drop, ...rest } = pane;
                return { ...rest, sessionId: undefined, running: false, waitingForInput: false };
              });
            const project: Project = {
              id: oldProject.id,
              root: oldProject.root,
              panes: panes.length > 0 ? panes : [{ id: newId(), type: "terminal" }],
              activeTerminalId: null,
            };
            projects.push(project);
            if (w.id === oldActiveWorkspaceId && oldProject.id === w.activeProjectId) {
              activeProjectId = project.id;
            }
          }
        }
        if (!activeProjectId) activeProjectId = projects[0]?.id ?? null;

        return { ...current, settings, projects, activeProjectId };
      },
    },
  ),
);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/store/projectStore.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Delete the old store and its test**

```bash
git rm src/store/workspaceStore.ts src/store/workspaceStore.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/store/projectStore.ts src/store/projectStore.test.ts
git commit -m "refactor: replace workspaceStore with a flat projectStore"
```

*(Expect every other file in the repo to now fail to typecheck — that's resolved by Tasks 2-6, not a regression to fix here.)*

---

## Task 2: Sidebar — merge the Projects list in, drop templates

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/Sidebar.test.tsx`
- Delete: `src/components/ProjectPanel.tsx`, `src/components/ProjectPanel.test.tsx`

**Interfaces:**
- Consumes: `useProjectStore`, `Project`, `Pane` from `../store/projectStore`; `projectName` from `../lib/gitUtils`; `pickDirectory` and `releaseLspSession` (same imports `ProjectPanel.tsx` uses today).
- Produces: no new exports — `Sidebar` keeps its current `export function Sidebar()` signature.

- [ ] **Step 1: Update `Sidebar.test.tsx` fixtures and expectations first**

Replace the `reset()` helper and the "Sidebar"/"Sidebar agent dashboard" describe blocks' fixtures to use `projects` instead of `workspaces`, e.g.:

```ts
import { useProjectStore } from "../store/projectStore";

function reset() {
  useProjectStore.setState({
    projects: [
      { id: "w1", root: "/repo/alpha", panes: [{ id: "p1", type: "terminal" }], activeTerminalId: null },
      { id: "w2", root: "/repo/beta", panes: [{ id: "p2", type: "terminal" }], activeTerminalId: null },
    ],
    activeProjectId: "w1",
    settings: useProjectStore.getState().settings,
    closedPanes: [],
  });
}
```

Rename every occurrence of `store().workspaces` → `store().projects`, `activeWorkspaceId` → `activeProjectId`, `"Alpha"`/`"Beta"` text assertions → `"alpha"`/`"beta"` (folder names via `projectName`, lowercase to match the fixture roots above — adjust fixture roots to whatever casing keeps existing test intent, e.g. `/repo/Alpha`, `/repo/Beta` if the tests assert capitalized text). Delete every test about rename (`"pencil opens inline rename..."`, `"double-click opens rename too"`, `"Escape cancels rename..."`, `"empty name is rejected..."`) and every test about templates (`"save as template..."`, `"declining the prompt..."`, `"lists saved templates..."`, `"deletes a template"`) — those features no longer exist. Keep and adapt: `"lists all workspaces"` → `"lists all projects"` (checks both folder names render), `"clicking a workspace activates it"` → `"clicking a project activates it"`, `"add button creates a workspace"` → replace with a project-add test using a mocked `pickDirectory` (see `ProjectPanel.test.tsx` today for that mock's exact shape — reuse it), `"X removes a workspace when more than one exists"` → `"X removes a project"`, dropping the "when more than one exists" guard since removal is now allowed down to zero.

For the "Sidebar agent dashboard" describe block: replace `workspaceId`/`workspaceName` fixture fields with `projectId`, and drop the `projectLabel`-based assertions (`"website-v2 · Alpha"` style) in favor of just the project's folder name (`"website-v2"` in that same example, since the project *is* the folder — adjust the fixture's `root` to `"/home/me/website-v2"` and assert on `"website-v2"` alone, no `·` compound).

- [ ] **Step 2: Run the test file to see it fail against the still-old `Sidebar.tsx`**

Run: `npx vitest run src/components/Sidebar.test.tsx`
Expected: FAIL (old component still imports the deleted `workspaceStore`)

- [ ] **Step 3: Rewrite `Sidebar.tsx`**

Replace the import line and the "Workspaces" + "Templates" sections. Key changes from the current file:

```tsx
import { useProjectStore, projectName /* re-exported? */ } from "../store/projectStore";
```

`projectName` lives in `../lib/gitUtils`, not the store — import it from there instead:

```tsx
import { useState } from "react";
import { useProjectStore, Pane, Project } from "../store/projectStore";
import { pickDirectory } from "../lib/tauri";
import { releaseLspSession } from "../lib/lspClient";
import { projectName } from "../lib/gitUtils";
import { Plus, X, Flame, PanelLeftClose } from "lucide-react";
```

(Drop `Pencil`, `Bookmark`, `LayoutTemplate`, `Rocket`, `Workspace` type imports — no longer used. `PanelLeftClose` was already removed in an earlier session change; confirm against the current file before assuming it's still imported.)

Replace the `AgentEntry` interface and its construction:

```tsx
interface AgentEntry {
  pane: Pane;
  projectId: string;
  projectRoot: string;
}
```

```tsx
const agentEntries: AgentEntry[] = projects.flatMap((p) =>
  p.panes
    .filter((pane) => !pane.overlay && pane.color && pane.title)
    .map((pane) => ({ pane, projectId: p.id, projectRoot: p.root })),
);
```

Replace `jumpToAgent` and `dismissAgent`:

```tsx
const jumpToAgent = (entry: AgentEntry) => {
  store.setActiveProject(entry.projectId);
  if (entry.pane.backgrounded) {
    store.setPaneBackgrounded(entry.pane.id, false, entry.projectId);
  }
  if (entry.pane.sessionId) {
    store.setActiveTerminal(entry.pane.sessionId, entry.projectId);
  }
};

const dismissAgent = (entry: AgentEntry) => {
  store.renamePane(entry.pane.id, undefined, entry.projectId);
  store.setPaneColor(entry.pane.id, undefined, entry.projectId);
};
```

(This drops the old `if (entry.pane.projectId) store.setActiveProject(...)` step entirely — jumping to an agent now always activates its project directly, since there's no separate "select this project within the workspace" indirection anymore.)

Update the render: `entry.workspaceId` → `entry.projectId`, and the label line:

```tsx
<span className="block text-[10px] text-[#6f6455] truncate">
  {projectName(entry.projectRoot)}
</span>
```

Replace the "Workspaces" section (the `<div>` with the "WORKSPACES" header, add button, and `workspaces.map(...)` list) with:

```tsx
<div>
  <div className="flex items-center justify-between mb-2 px-1">
    <span className="text-[10px] font-display font-semibold text-[#6f6455] uppercase tracking-widest">
      Projects
    </span>
    <button
      onClick={async () => {
        const path = await pickDirectory();
        if (path) store.addProject(path);
      }}
      className="p-1 rounded-md text-[#a99a86] hover:text-accent hover:bg-white/[0.05] transition-colors"
      title="Add project"
    >
      <Plus size={13} />
    </button>
  </div>
  <div className="space-y-0.5">
    {projects.length === 0 ? (
      <div className="text-center py-4 rounded-xl border border-dashed border-white/10 bg-[#1d1811]/40">
        <p className="text-xs text-[#8a7c68]">No projects yet</p>
      </div>
    ) : (
      projects.map((p) => {
        const isActive = p.id === activeId;
        const visibleBayCount = p.panes.filter((pane) => !pane.overlay && !pane.backgrounded).length;
        return (
          <div
            key={p.id}
            onClick={() => store.setActiveProject(p.id)}
            className={`group flex items-center gap-2.5 px-2 py-1.5 rounded-md text-[13px] font-medium cursor-pointer transition-colors border ${
              isActive
                ? "bg-accent/10 border-accent/30 text-[#f3e9d8]"
                : "bg-transparent border-transparent text-[#a99a86] hover:bg-white/[0.04] hover:text-[#f3e9d8]"
            }`}
          >
            <span
              className={`shrink-0 w-2 h-2 rounded-sm ${isActive ? "bg-accent" : "bg-[#6f6455]"}`}
              style={isActive ? { boxShadow: "0 0 6px 1px var(--color-accent)" } : undefined}
            />
            <span className="flex-1 truncate">{projectName(p.root)}</span>
            <span className="flex items-center shrink-0">
              <span
                className="mr-0.5 font-mono text-[10px] text-[#6f6455] group-hover:opacity-0 transition-opacity"
                title={`${visibleBayCount} bay${visibleBayCount === 1 ? "" : "s"}`}
              >
                {visibleBayCount}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  releaseLspSession(p.root);
                  store.removeProject(p.id);
                }}
                className="opacity-0 group-hover:opacity-100 p-1 rounded text-[#6f6455] hover:text-rose-300 hover:bg-rose-500/20 transition-all"
                title="Remove project"
              >
                <X size={11} />
              </button>
            </span>
          </div>
        );
      })
    )}
  </div>
</div>
```

Delete the whole "Templates" section (`{store.templates.length > 0 && (...)}` block) and the `editingId`/`editingName`/`startRename`/`commitRename`/`saveAsTemplate` state and functions — none of that exists anymore. Remove the `<ProjectPanel />` render at the bottom of the component (its job is now done by the section above) and delete its import.

`const store = useProjectStore(); const projects = store.projects; const activeId = store.activeProjectId ?? projects[0]?.id ?? null;` replaces the old `workspaces`/`activeId` derivation.

- [ ] **Step 4: Delete `ProjectPanel.tsx` and its test**

```bash
git rm src/components/ProjectPanel.tsx src/components/ProjectPanel.test.tsx
```

- [ ] **Step 5: Run the Sidebar test file**

Run: `npx vitest run src/components/Sidebar.test.tsx`
Expected: PASS (this file typechecks and runs standalone even though the rest of the app doesn't yet — `Sidebar.tsx` only imports from `projectStore.ts`, `gitUtils.ts`, `tauri.ts`, `lspClient.ts`, all already updated/unaffected)

- [ ] **Step 6: Commit**

```bash
git add src/components/Sidebar.tsx src/components/Sidebar.test.tsx
git commit -m "refactor: merge the Projects list into Sidebar, delete ProjectPanel"
```

---

## Task 3: Rename Workspace.tsx → ProjectView.tsx

**Files:**
- Create: `src/components/ProjectView.tsx` (replaces `src/components/Workspace.tsx`, deleted)
- Create: `src/components/ProjectView.test.tsx` (replaces `src/components/Workspace.test.tsx`, deleted)
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `useProjectStore`, `Project`, `Pane` from `../store/projectStore`; `projectName` from `../lib/gitUtils`.
- Produces: `export function ProjectView()`, rendered by `App.tsx` in place of `Workspace`.

- [ ] **Step 1: Update `App.tsx`**

```tsx
import { useEffect } from "react";
import { ProjectView } from "./components/ProjectView";
import { useProjectStore } from "./store/projectStore";
import { applyUiTheme } from "./lib/themes";

function App() {
  const theme = useProjectStore((s) => s.settings.theme);

  useEffect(() => {
    applyUiTheme(theme);
  }, [theme]);

  return <ProjectView />;
}

export default App;
```

- [ ] **Step 2: Write `src/components/ProjectView.test.tsx`**

Copy `Workspace.test.tsx` as the starting point, then apply these changes throughout:
- Import `{ ProjectView }` from `./ProjectView` instead of `{ Workspace }` from `./Workspace`; every `<Workspace />` → `<ProjectView />`.
- Import `useProjectStore` from `../store/projectStore`.
- `reset()`'s fixture becomes a flat `projects: [{ id: "w1", root: "/repo/Workspace 1", panes: [...], activeTerminalId: null }]` (keep the root's last segment as `"Workspace 1"` so the existing `"renders workspace name..."` text assertions keep working unchanged — rename the test's own title/wording to reference "project" instead of "workspace" but the literal folder-name string in fixtures can stay whatever reads naturally, e.g. `/repo/proj-1`, updating the assertion strings to match).
- `activeWorkspaceId: null` → `activeProjectId: null`; every `store().workspaces[0]` → `store().projects[0]`; every `store().addPane("w1")` stays identical (same call shape, `projectId` optional parameter).
- The `describe("sidebar collapse", ...)` and `describe("git panel collapse", ...)` blocks (Ctrl+B / Ctrl+G) need no logic changes — copy verbatim.
- Add two new tests:

```tsx
describe("zero-project empty state", () => {
  it("shows an empty state instead of the header/grid when there are no projects", () => {
    useProjectStore.setState({ projects: [], activeProjectId: null });
    render(<ProjectView />);
    expect(screen.getByText(/add a project to get started/i)).toBeInTheDocument();
    expect(screen.queryByText("New Bay")).not.toBeInTheDocument();
  });
});

describe("Ctrl+Shift+[ and ] cycle projects", () => {
  it("cycles the active project forward and backward", () => {
    useProjectStore.setState({
      projects: [
        { id: "w1", root: "/repo/one", panes: [{ id: "p1", type: "terminal" }], activeTerminalId: null },
        { id: "w2", root: "/repo/two", panes: [{ id: "p2", type: "terminal" }], activeTerminalId: null },
      ],
      activeProjectId: "w1",
    });
    render(<ProjectView />);
    fireEvent.keyDown(window, { key: "]", ctrlKey: true, shiftKey: true });
    expect(useProjectStore.getState().activeProjectId).toBe("w2");
    fireEvent.keyDown(window, { key: "[", ctrlKey: true, shiftKey: true });
    expect(useProjectStore.getState().activeProjectId).toBe("w1");
  });
});
```

- [ ] **Step 3: Run the new test file to see it fail (module doesn't exist)**

Run: `npx vitest run src/components/ProjectView.test.tsx`
Expected: FAIL — `Cannot find module './ProjectView'`

- [ ] **Step 4: Write `src/components/ProjectView.tsx`**

Copy `Workspace.tsx` to `ProjectView.tsx` and apply these changes (the pure layout/grid-math helper functions — `shellBadge`, `baseName`, `paneStatusDotClass`, `paneStatusGlow`, `hasDraggableLayout`, `getGridTemplate`, `panePlacement`, `formatUptime`, `PANE_COLOR_PALETTE` — are copied unchanged):

Import line:

```tsx
import { useProjectStore, Pane, Project } from "../store/projectStore";
import { projectName } from "../lib/gitUtils";
```

(drop the `panesForProject` import — deleted from the store; `Workspace` type import → `Project`)

Rename `export function Workspace()` → `export function ProjectView()`. Replace the top-of-component derivations:

```tsx
const store = useProjectStore();
const project = store.getActiveProject();
const projectPanes = project ? project.panes.filter((p) => !p.overlay) : [];
const panes = projectPanes.filter((p) => !p.backgrounded);
const backgroundedPanes = projectPanes.filter((p) => p.backgrounded);
const overlayPanes = project?.panes.filter((p) => p.overlay) ?? [];
const count = panes.length;
const activeTerminalId = project?.activeTerminalId ?? null;
const liveCount = projectPanes.filter((p) => p.running).length;
const visibleIds = new Set(panes.map((p) => p.id));

const allPanes = store.projects.flatMap((p) => p.panes.filter((pane) => !pane.overlay));
```

In the keydown effect: `cycleWorkspace` → `cycleProject`:

```tsx
const cycleProject = (dir: number) => {
  const s = useProjectStore.getState();
  const list = s.projects;
  if (list.length === 0) return;
  const idx = list.findIndex((p) => p.id === (s.activeProjectId ?? list[0].id));
  const next = list[(idx + dir + list.length) % list.length];
  s.setActiveProject(next.id);
};
```

and its two call sites (`cycleWorkspace(1)` / `cycleWorkspace(-1)`) become `cycleProject(1)` / `cycleProject(-1)`. `cyclePane` simplifies (no more `panesForProject`):

```tsx
const cyclePane = (dir: number) => {
  const p = useProjectStore.getState().getActiveProject();
  if (!p) return;
  const gridPanes = p.panes.filter((pane) => !pane.overlay && pane.sessionId && !pane.backgrounded);
  if (gridPanes.length === 0) return;
  const idx = gridPanes.findIndex((pane) => pane.sessionId === p.activeTerminalId);
  const next = gridPanes[(idx + dir + gridPanes.length) % gridPanes.length];
  if (next.sessionId) useProjectStore.getState().setActiveTerminal(next.sessionId);
};
```

The `"p"` shortcut (go-to-file):

```tsx
if (!e.shiftKey && e.key.toLowerCase() === "p") {
  e.preventDefault();
  if (useProjectStore.getState().getActiveProject()) setShowFileFinder(true);
  return;
}
```

The digit shortcut:

```tsx
if (!e.shiftKey && /^[1-9]$/.test(e.key)) {
  const p = useProjectStore.getState().getActiveProject();
  const gridPanes = p ? p.panes.filter((pane) => !pane.overlay && !pane.backgrounded) : [];
  const target = gridPanes[Number(e.key) - 1];
  if (target?.sessionId) {
    e.preventDefault();
    useProjectStore.getState().setActiveTerminal(target.sessionId);
  }
}
```

`label`:

```tsx
const label = project ? projectName(project.root) : "Flame";
```

Wrap the existing header + `<div className="flex-1 min-h-0 flex gap-3 p-3 overflow-hidden">...</div>` block (everything from the `<header>` through the closing of that gap-3 flex div, i.e. main grid + `<GitPanel/>`) in a conditional, adding an empty state alongside it:

```tsx
{!project ? (
  <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[#8a7c68] text-center px-4">
    <FolderOpen size={32} className="text-[#352c1e]" />
    <p className="text-sm">Add a project to get started</p>
    <button
      onClick={async () => {
        const path = await pickDirectory();
        if (path) store.addProject(path);
      }}
      className="text-xs px-3 py-1.5 rounded-md bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20 transition-colors"
    >
      Add Project
    </button>
  </div>
) : (
  <>
    <header className="...">...</header>
    {backgroundedPanes.length > 0 && (...)}
    <div className="flex-1 min-h-0 flex gap-3 p-3 overflow-hidden">
      <main ...>...</main>
      {!store.settings.gitPanelCollapsed && <GitPanel />}
    </div>
    {overlayPanes.map((pane) => (...))}
  </>
)}
```

(Everything inside the `header`/`main`/overlay markup is otherwise unchanged — only the derivations feeding it, already covered above, change.) Add `FolderOpen` and `pickDirectory` to the imports (`lucide-react` and `../lib/tauri` respectively — `../lib/tauri` is likely not yet imported in this file; add it).

`FileFinder`/`FileEditorDialog` rendering block: `project.root` replaces `project.root` (unchanged — `project` is already the right variable, just now sourced directly from `store.getActiveProject()` instead of a nested lookup).

Anywhere else `store.swapPanes(...)`, `store.removePane(...)`, `store.setPaneBackgrounded(...)`, `store.addPane()` are called with no explicit id: unchanged, since the store still defaults to the active project.

- [ ] **Step 5: Delete the old component and test**

```bash
git rm src/components/Workspace.tsx src/components/Workspace.test.tsx
```

- [ ] **Step 6: Run the new test file**

Run: `npx vitest run src/components/ProjectView.test.tsx`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/components/ProjectView.tsx src/components/ProjectView.test.tsx
git commit -m "refactor: rename Workspace to ProjectView, add empty-project state"
```

---

## Task 4: GitPanel

**Files:**
- Modify: `src/components/GitPanel.tsx`
- Modify: `src/components/GitPanel.test.tsx`

**Interfaces:**
- Consumes: `useProjectStore` from `../store/projectStore` (in place of `useWorkspaceStore`).

- [ ] **Step 1: Update `GitPanel.test.tsx` fixtures**

Wherever it seeds `useWorkspaceStore.setState({ workspaces: [...] })`, replace with `useProjectStore.setState({ projects: [...], activeProjectId: ... })` using the flat `Project` shape (no nested `projects` array inside each entry — a fixture project is just `{ id, root, panes, activeTerminalId }`). Update the import to `useProjectStore` from `../store/projectStore`.

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/components/GitPanel.test.tsx`
Expected: FAIL (old component still imports the deleted store)

- [ ] **Step 3: Update `GitPanel.tsx`**

```tsx
import { useProjectStore } from "../store/projectStore";
```

```tsx
function openLazygit(root: string) {
  const store = useProjectStore.getState();
  const project = store.getActiveProject();
  if (!project) return;
  store.addOverlayPane(`lazygit -p ${quotedShell(root)}`, "lazygit", project.id);
}

export function GitPanel() {
  const store = useProjectStore();
  const project = store.getActiveProject();
  // ...rest of the component body is unchanged — every other reference to
  // `project` (refreshGit, the effect, editingFile/FileEditorDialog,
  // buildTree, etc.) already worked off this same variable.
```

- [ ] **Step 4: Run the test file**

Run: `npx vitest run src/components/GitPanel.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/GitPanel.tsx src/components/GitPanel.test.tsx
git commit -m "refactor: point GitPanel at projectStore"
```

---

## Task 5: CommandPalette

**Files:**
- Modify: `src/components/CommandPalette.tsx`
- Modify: `src/components/CommandPalette.test.tsx`

- [ ] **Step 1: Update `CommandPalette.test.tsx` fixtures**

Same fixture-shape change as Task 4 (`useProjectStore`, flat `projects`). Delete any test asserting on "New Workspace" or "New Workspace from Template" actions. Update "Switch to Workspace" assertions to "Switch to Project".

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/components/CommandPalette.test.tsx`
Expected: FAIL

- [ ] **Step 3: Update `CommandPalette.tsx`**

```tsx
import { useProjectStore } from "../store/projectStore";
import { pickDirectory } from "../lib/tauri";
import { projectName, quotedShell } from "../lib/gitUtils";
```

```tsx
const store = useProjectStore();
const project = store.getActiveProject();
```

Delete the `"new-workspace"` action block entirely (no replacement — `"add-project"` already covers it).

```tsx
for (const p of store.projects) {
  if (p.id === project?.id) continue;
  list.push({
    id: `switch-project-${p.id}`,
    label: `Switch to Project: ${projectName(p.root)}`,
    icon: <Layers size={14} />,
    run: () => store.setActiveProject(p.id),
  });
}

if (project) {
  const gridPanes = project.panes.filter((p) => !p.overlay);
  gridPanes.forEach((p, i) => {
    if (!p.sessionId || p.sessionId === project.activeTerminalId) return;
    list.push({
      id: `jump-pane-${p.id}`,
      label: `Jump to ${p.title ?? `Terminal ${i + 1}`}`,
      icon: <TerminalIcon size={14} />,
      run: () => store.setActiveTerminal(p.sessionId!),
    });
  });

  list.push({
    id: "open-lazygit",
    label: `Open lazygit — ${projectName(project.root)}`,
    icon: <SquareTerminal size={14} />,
    run: () =>
      store.addOverlayPane(`lazygit -p ${quotedShell(project.root)}`, "lazygit", project.id),
  });
  list.push({
    id: "go-to-file",
    label: "Go to File…",
    hint: "⌘P",
    icon: <FileSearch size={14} />,
    run: onOpenFileFinder,
  });
}
```

Delete the `for (const t of store.templates)` block entirely. Remove now-unused imports (`Layers` stays — still used for the switch-project entries; `LayoutTemplate` is dropped). `"new-terminal"`'s `hint: "in current workspace"` → `hint: "in current project"`.

- [ ] **Step 4: Run the test file**

Run: `npx vitest run src/components/CommandPalette.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/CommandPalette.tsx src/components/CommandPalette.test.tsx
git commit -m "refactor: point CommandPalette at projectStore, drop workspace/template actions"
```

---

## Task 6: TerminalPane + full-suite verification

**Files:**
- Modify: `src/components/TerminalPane.tsx`

**Interfaces:**
- Consumes: `useProjectStore` from `../store/projectStore`. No test file of its own (unchanged — it's exercised via `ProjectView.test.tsx`'s mock, per the existing convention).

- [ ] **Step 1: Update `TerminalPane.tsx`**

```tsx
import { useProjectStore } from "../store/projectStore";
```

Every `useWorkspaceStore` → `useProjectStore` (mechanical, ~15 call sites: `setPaneRunning`, `setPaneWaiting`, `renamePane`, `setPaneColor`, `getActiveProject` in place of `getActiveWorkspace`, `setSessionId`, `setActiveTerminal`, `clearPaneStartupCommand`, `subscribe`, `settings`).

The two `.workspaces.flatMap((w) => w.panes)` pane-lookups become:

```tsx
const pane = useProjectStore
  .getState()
  .projects.flatMap((p) => p.panes)
  .find((x) => x.id === paneId);
```

The owning-project cwd resolution block replaces:

```tsx
const owningWorkspace = useWorkspaceStore
  .getState()
  .workspaces.find((w) => w.panes.some((p) => p.id === paneId));
const pane = owningWorkspace?.panes.find((p) => p.id === paneId);
const paneProjectRoot = owningWorkspace?.projects.find(
  (pr) => pr.id === pane?.projectId,
)?.root;
const cwd = pane?.cwd ?? paneProjectRoot ?? useWorkspaceStore.getState().activeCwd();
```

with:

```tsx
const owningProject = useProjectStore
  .getState()
  .projects.find((p) => p.panes.some((pane) => pane.id === paneId));
const pane = owningProject?.panes.find((p) => p.id === paneId);
const cwd = pane?.cwd ?? owningProject?.root ?? useProjectStore.getState().activeCwd();
```

`unsubActive`'s subscription:

```tsx
unsubActive = useProjectStore.subscribe((s) => {
  const activeId = s.getActiveProject()?.activeTerminalId;
  ...
```

- [ ] **Step 2: Full-suite verification**

Run: `npx vitest run`
Expected: PASS — all test files, including the ones touched in Tasks 1-5.

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no output (clean).

Run: `cd src-tauri && cargo test && cd ..`
Expected: PASS, unchanged count from before this refactor (no Rust files touched).

- [ ] **Step 3: Grep-sweep for anything missed**

```bash
grep -rn "workspaceStore\|useWorkspaceStore\|getActiveWorkspace\|panesForProject\|WorkspaceTemplate\|activeWorkspaceId" src/
```

Expected: no matches. If any turn up, fix them before continuing — they indicate a spot Tasks 1-6 didn't cover.

- [ ] **Step 4: Commit**

```bash
git add src/components/TerminalPane.tsx
git commit -m "refactor: point TerminalPane at projectStore, completing workspace removal"
```
