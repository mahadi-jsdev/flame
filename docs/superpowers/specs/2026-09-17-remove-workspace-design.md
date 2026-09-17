# Remove Workspace — Design

## Context

Flame's data model currently nests two nearly-parallel container concepts: a `Workspace` (named, switchable, holds one or more `Project`s plus a pool of panes not scoped to any project) containing `Project`s (a folder root). In practice the user reports never using a workspace to group more than one project, or switching between named workspaces — the workspace layer is pure overhead on top of "pick a folder, get some terminals."

This removes `Workspace` entirely. `Project` becomes the top-level unit: it owns its panes directly, and the sidebar's workspace switcher is replaced by a project switcher (merging with the existing bottom-of-sidebar "Projects" list, which today does something different: add/remove projects *within* the active workspace).

## Decisions

- **Workspace templates**: dropped entirely. They saved/relaunched a *group* of projects + startup panes together — a shape that only mattered when a workspace could hold several projects. Per-project pane layout already survives restarts via the existing persistence, so there's no gap once the multi-project grouping is gone.
- **Unscoped panes** (terminals opened with no project active — possible today because a workspace could exist with zero projects): dropped on migration. Every pane must belong to a project going forward; there is no more "no project selected, but panes still open" state.
- **Project naming**: folder name only (`projectName(root)`, already the existing helper). No custom rename UI, no separate display-name field.
- **Zero-project state**: with no projects, the main view shows an empty "Add a project to get started" screen instead of a header + terminal grid — this is a real, first-class state now, not an edge case to special-case away.

## Data model (`src/store/workspaceStore.ts` → `src/store/projectStore.ts`)

`Workspace` and `WorkspaceTemplate` interfaces are deleted. `Project` gains the fields `Workspace` used to have, minus the nested `projects` array:

```ts
export interface Project {
  id: string;
  root: string;
  panes: Pane[];
  activeTerminalId: string | null;
}
```

`Pane.projectId` is deleted — a pane's project is now structural (which `Project.panes` array it lives in), not a foreign key, so `panesForProject` is deleted too. Every pane-mutating action keeps today's "optional target id, defaults to the active one" shape (needed because the sidebar's Agents list addresses panes in non-active projects), just renamed `workspaceId` → `projectId`:

```ts
interface ProjectState {
  projects: Project[];
  activeProjectId: string | null;
  settings: AppSettings;
  closedPanes: ClosedPane[]; // ClosedPane now { pane: Pane; projectId: string }

  getActiveProject: () => Project | undefined;
  addProject: (root: string) => void;
  removeProject: (id: string) => void;   // allowed down to zero projects
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

  activeCwd: () => string | undefined; // getActiveProject()?.root directly — no nested lookup
  updateSettings: (patch: Partial<AppSettings>) => void;
}
```

Initial/empty state: `{ projects: [], activeProjectId: null }` (today's default seeds one empty workspace with a blank pane — that "blank pane with no project" state no longer exists).

`removeProject` no longer force-keeps a minimum of one — going to zero projects is the normal path into the empty state.

### Migration

The existing `merge()` already normalizes pre-per-project-scoping persisted data into today's `workspaces[].projects[]` + `projectId`-tagged-panes shape — that normalization step is kept as-is. A new flattening pass runs after it:

- For each old workspace, for each of its projects: create a top-level `Project` with `panes = workspace.panes.filter(p => p.projectId === project.id)`, each pane stripped of `projectId`.
- Panes with no `projectId` (unscoped) are dropped, per the decision above.
- `templates` are dropped entirely, not migrated.
- `activeProjectId` becomes whichever project was active in whichever workspace was active (falls back to the first migrated project, or `null` if none).

If `settings.restoreSession` is `false`, or there's no persisted data at all, skip straight to `{ projects: [], activeProjectId: null }`.

## Components

### `src/components/Sidebar.tsx`

The "Workspaces" list section is replaced by a "Projects" list, absorbing what `ProjectPanel.tsx` does today (add via `pickDirectory`, remove via `releaseLspSession(root)` + `store.removeProject(id)`). Per row: folder name (`projectName(root)`), a bay-count chip (`project.panes.filter(p => !p.backgrounded).length` — no more `panesForProject` indirection), and a remove button (no minimum-one guard). No rename button, no "save as template" button. The "Templates" section is deleted outright. The Agents section keeps its current shape but simplifies: `AgentEntry` drops `projectLabel` (there's no more "which project within this workspace" distinction — the project *is* the container) and its workspace-scoped fields become project-scoped (`entry.workspaceId` → `entry.projectId`, `entry.workspaceName` → `projectName(project.root)`), and the display line collapses from `"{projectLabel} · {workspaceName}"` to just the project's folder name.

`ProjectPanel.tsx` and `ProjectPanel.test.tsx` are deleted.

### `src/components/Workspace.tsx` → `src/components/ProjectView.tsx`

Renamed for clarity — it's the main shell (header, terminal grid, keyboard shortcuts, drag/drop, file finder wiring), not a workspace concept. `useWorkspaceStore` → `useProjectStore`, `getActiveWorkspace()` → `getActiveProject()`. `projectPanes` becomes `project.panes.filter(p => !p.overlay)` directly (no `panesForProject` call). Header shows `projectName(project.root)` in place of the workspace's custom name. `cycleWorkspace` (bound to Ctrl+Shift+`[`/`]`) becomes `cycleProject`, iterating `store.projects`. When `store.projects.length === 0`, the header/grid/git-panel layout is replaced by an empty state ("Add a project to get started" + a button wired to the same `pickDirectory` flow), mirroring `GitPanel`'s existing no-project empty state visually.

`App.tsx` updates its import/render from `Workspace` to `ProjectView`.

### `src/components/GitPanel.tsx`

Simplifies: today it does `getActiveWorkspace()` then finds the project inside it; that collapses to one `getActiveProject()` call. `addOverlayPane(command, title, workspaceId)` (lazygit launch) → `addOverlayPane(command, title, projectId)`.

### `src/components/CommandPalette.tsx`

`switch-ws-${w.id}` / "Switch to Workspace: {name}" entries → `switch-project-${p.id}` / "Switch to Project: {folderName}", iterating `store.projects`. `template-${t.id}` entries are deleted (templates gone).

### `src/components/TerminalPane.tsx`

`useWorkspaceStore` → `useProjectStore`. Pane lookups (`.workspaces.flatMap(w => w.panes).find(...)`) become `.projects.flatMap(p => p.panes).find(...)`. cwd resolution simplifies: today it looks up the owning workspace, then finds the project inside it by `pane.projectId` to get `.root`; in the new model the owning `Project` already has `.root` directly, no second lookup.

## Testing

- `src/store/workspaceStore.test.ts` → `src/store/projectStore.test.ts`: rewritten for the flat model — project CRUD, pane actions addressed by explicit vs. default-active `projectId`, `closedPanes`/reopen, migration from the old nested persisted shape (including the unscoped-panes-dropped and templates-dropped cases), and the "removeProject can reach zero" behavior.
- `Sidebar.test.tsx`: rewritten fixtures (flat `projects` instead of `workspaces`), covering the merged add/remove-project row, the bay-count chip, and the simplified Agents entries.
- `Workspace.test.tsx` → `ProjectView.test.tsx`: rewritten fixtures; add coverage for the new zero-project empty state and `cycleProject`.
- `GitPanel.test.tsx`, `CommandPalette.test.tsx`: fixtures updated to the flat model; no behavioral surface change beyond the renamed switch entries and dropped template entries.
- `ProjectPanel.test.tsx`: deleted along with the component.
- Full suite + `tsc --noEmit` + `cargo test` (unaffected by this pass — no Rust changes) run at the end, same as every prior change this session.

## Out of scope (this pass)

- Any replacement for "group several projects together" (the workspace's one genuinely lost capability) — not requested.
- A rename/custom-label capability for projects.
- Any new file-manager UI (separate, deferred earlier in this session).
