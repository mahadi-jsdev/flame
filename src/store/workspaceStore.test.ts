import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultSettings,
  useWorkspaceStore,
  Workspace,
} from "./workspaceStore";

function ws(over: Partial<Workspace> = {}): Workspace {
  return {
    id: "w1",
    name: "Workspace 1",
    projects: [],
    activeProjectId: null,
    panes: [{ id: "p1", type: "terminal" }],
    activeTerminalId: null,
    ...over,
  };
}

function reset() {
  useWorkspaceStore.setState({
    workspaces: [ws()],
    activeWorkspaceId: null,
    settings: defaultSettings,
    templates: [],
    closedPanes: [],
  });
}

const store = () => useWorkspaceStore.getState();
const w1 = () => store().workspaces.find((w) => w.id === "w1")!;

beforeEach(() => {
  localStorage.clear();
  reset();
});

describe("workspaces", () => {
  it("starts with one workspace and one terminal pane", () => {
    expect(store().workspaces).toHaveLength(1);
    expect(w1().panes).toHaveLength(1);
    expect(w1().panes[0].type).toBe("terminal");
  });

  it("addWorkspace appends numbered workspaces", () => {
    store().addWorkspace();
    store().addWorkspace();
    const names = store().workspaces.map((w) => w.name);
    expect(names).toEqual(["Workspace 1", "Workspace 2", "Workspace 3"]);
    store().workspaces.slice(1).forEach((w) => {
      expect(w.panes).toHaveLength(1);
      expect(w.projects).toEqual([]);
    });
  });

  it("getActiveWorkspace falls back to first when no active id", () => {
    expect(store().getActiveWorkspace()?.id).toBe("w1");
  });

  it("setActiveWorkspace switches active", () => {
    store().addWorkspace();
    const w2 = store().workspaces[1];
    store().setActiveWorkspace(w2.id);
    expect(store().activeWorkspaceId).toBe(w2.id);
    expect(store().getActiveWorkspace()?.id).toBe(w2.id);
  });

  it("renameWorkspace renames", () => {
    store().renameWorkspace("w1", "Agents");
    expect(w1().name).toBe("Agents");
  });

  it("renameWorkspace on unknown id is a no-op", () => {
    store().renameWorkspace("nope", "X");
    expect(w1().name).toBe("Workspace 1");
  });

  it("removeWorkspace removes and never leaves zero", () => {
    store().addWorkspace();
    store().removeWorkspace("w1");
    expect(store().workspaces).toHaveLength(1);
    store().removeWorkspace(store().workspaces[0].id);
    expect(store().workspaces).toHaveLength(1);
    expect(store().workspaces[0].name).toBe("Workspace 1");
  });

  it("removeWorkspace resets active id", () => {
    store().setActiveWorkspace("w1");
    store().addWorkspace();
    store().removeWorkspace("w1");
    expect(store().activeWorkspaceId).toBe(store().workspaces[0].id);
  });
});

describe("projects", () => {
  it("addProject appends and activates", () => {
    store().addProject("/repo/a", "w1");
    store().addProject("/repo/b", "w1");
    expect(w1().projects.map((p) => p.root)).toEqual(["/repo/a", "/repo/b"]);
    expect(w1().activeProjectId).toBe(w1().projects[1].id);
  });

  it("setActiveProject switches", () => {
    store().addProject("/repo/a", "w1");
    store().addProject("/repo/b", "w1");
    const first = w1().projects[0].id;
    store().setActiveProject(first, "w1");
    expect(w1().activeProjectId).toBe(first);
  });

  it("removeProject fixes activeProjectId", () => {
    store().addProject("/repo/a", "w1");
    store().addProject("/repo/b", "w1");
    const active = w1().activeProjectId!;
    store().removeProject(active, "w1");
    expect(w1().projects).toHaveLength(1);
    expect(w1().activeProjectId).toBe(w1().projects[0].id);
  });

  it("removeProject to empty sets activeProjectId null", () => {
    store().addProject("/repo/a", "w1");
    store().removeProject(w1().projects[0].id, "w1");
    expect(w1().activeProjectId).toBeNull();
  });

  it("activeCwd returns active project root", () => {
    store().addProject("/repo/a", "w1");
    expect(store().activeCwd()).toBe("/repo/a");
  });

  it("activeCwd is undefined without projects", () => {
    expect(store().activeCwd()).toBeUndefined();
  });
});

describe("panes", () => {
  it("addPane appends a terminal pane", () => {
    store().addPane("w1");
    expect(w1().panes).toHaveLength(2);
    expect(w1().panes[1].type).toBe("terminal");
  });

  it("addPane stores startupCommand", () => {
    store().addPane("w1", "echo hi");
    expect(w1().panes[1].startupCommand).toBe("echo hi");
  });

  it("addPane with no workspaceId uses active workspace", () => {
    store().addPane();
    expect(w1().panes).toHaveLength(2);
  });

  it("removePane removes pane", () => {
    store().addPane("w1");
    store().removePane(w1().panes[1].id);
    expect(w1().panes).toHaveLength(1);
  });

  it("removePane always keeps at least one pane", () => {
    store().removePane("p1");
    expect(w1().panes).toHaveLength(1);
    expect(w1().panes[0].id).not.toBe("p1");
    expect(w1().panes[0].type).toBe("terminal");
  });

  it("removePane clears activeTerminalId when it was active", () => {
    store().addPane("w1");
    const p2 = w1().panes[1];
    store().setSessionId(p2.id, "sess-2", undefined, undefined, "w1");
    store().setActiveTerminal("sess-2");
    store().removePane(p2.id);
    expect(w1().activeTerminalId).toBeNull();
  });

  it("setSessionId records session", () => {
    store().setSessionId("p1", "abc", undefined, undefined, "w1");
    expect(w1().panes[0].sessionId).toBe("abc");
  });

  it("setSessionId records shell and cwd", () => {
    store().setSessionId("p1", "abc", "fish", "/repo/proj", "w1");
    expect(w1().panes[0].shell).toBe("fish");
    expect(w1().panes[0].cwd).toBe("/repo/proj");
  });

  it("setActiveTerminal sets active id", () => {
    store().setActiveTerminal("s9");
    expect(w1().activeTerminalId).toBe("s9");
  });

  it("clearPaneStartupCommand clears only that pane's command", () => {
    store().addPane("w1", "ls");
    const p2 = w1().panes[1];
    store().clearPaneStartupCommand(p2.id);
    expect(w1().panes[1].startupCommand).toBeUndefined();
  });
});

describe("overlay panes", () => {
  it("addOverlayPane adds an overlay terminal with title + command", () => {
    store().addOverlayPane("lazygit -p /x", "lazygit", "w1");
    const p = w1().panes.find((p) => p.overlay);
    expect(p).toBeDefined();
    expect(p!.startupCommand).toBe("lazygit -p /x");
    expect(p!.title).toBe("lazygit");
    expect(p!.type).toBe("terminal");
  });

  it("addOverlayPane replaces existing overlay instead of stacking", () => {
    store().addOverlayPane("cmd-a", "a", "w1");
    store().addOverlayPane("cmd-b", "b", "w1");
    const overlays = w1().panes.filter((p) => p.overlay);
    expect(overlays).toHaveLength(1);
    expect(overlays[0].title).toBe("b");
  });

  it("addOverlayPane keeps grid panes intact", () => {
    store().addPane("w1");
    store().addOverlayPane("cmd", "t", "w1");
    const grid = w1().panes.filter((p) => !p.overlay);
    expect(grid).toHaveLength(2);
  });

  it("overlay pane survives removePane fallback logic", () => {
    store().addOverlayPane("cmd", "t", "w1");
    const ov = w1().panes.find((p) => p.overlay)!;
    store().removePane(ov.id);
    expect(w1().panes.every((p) => !p.overlay)).toBe(true);
    expect(w1().panes.length).toBeGreaterThan(0);
  });
});

describe("swapPanes", () => {
  it("swaps two pane positions", () => {
    store().addPane("w1");
    store().addPane("w1");
    const ids = w1().panes.map((p) => p.id);
    store().swapPanes(ids[0], ids[2]);
    expect(w1().panes.map((p) => p.id)).toEqual([ids[2], ids[1], ids[0]]);
  });

  it("same id is a no-op", () => {
    store().addPane("w1");
    const ids = w1().panes.map((p) => p.id);
    store().swapPanes(ids[0], ids[0]);
    expect(w1().panes.map((p) => p.id)).toEqual(ids);
  });

  it("unknown id is a no-op", () => {
    const ids = w1().panes.map((p) => p.id);
    store().swapPanes("missing", ids[0]);
    expect(w1().panes.map((p) => p.id)).toEqual(ids);
  });
});

describe("settings", () => {
  it("has sane defaults", () => {
    expect(store().settings).toEqual(defaultSettings);
  });

  it("updateSettings merges a patch", () => {
    store().updateSettings({ fontSize: 18 });
    expect(store().settings.fontSize).toBe(18);
    expect(store().settings.cursorStyle).toBe("bar");
  });

  it("persists settings and workspace layout to localStorage", () => {
    store().updateSettings({ fontSize: 16 });
    store().addProject("/repo/a", "w1");
    const raw = localStorage.getItem("ai-terminal-agent-settings");
    expect(raw).toBeTruthy();
    const saved = JSON.parse(raw!);
    expect(saved.state.settings.fontSize).toBe(16);
    expect(saved.state.workspaces[0].projects[0].root).toBe("/repo/a");
  });

  it("updateSettings supports the AI fields", () => {
    store().updateSettings({ commitModel: "gpt-4o" });
    expect(store().settings.commitModel).toBe("gpt-4o");
  });

  it("rehydrates persisted settings, keeping defaults for missing keys", async () => {
    localStorage.setItem(
      "ai-terminal-agent-settings",
      JSON.stringify({
        state: { settings: { fontSize: 19 } },
        version: 0,
      }),
    );
    vi.resetModules();
    const mod = await import("./workspaceStore");
    const s = mod.useWorkspaceStore.getState();
    expect(s.settings.fontSize).toBe(19);
    expect(s.settings.cursorStyle).toBe("bar");
    expect(s.settings.diffViewer).toBe("auto");
    expect(s.workspaces).toHaveLength(1);
  });
});

describe("session persistence", () => {
  it("restores workspace layout, stripping live session fields", async () => {
    localStorage.setItem(
      "ai-terminal-agent-settings",
      JSON.stringify({
        state: {
          settings: defaultSettings,
          activeWorkspaceId: "w1",
          workspaces: [
            ws({
              projects: [{ id: "pr1", root: "/repo/a" }],
              activeProjectId: "pr1",
              panes: [
                { id: "p1", type: "terminal", sessionId: "sess-1", cwd: "/repo/a", running: true },
                { id: "p2", type: "terminal", overlay: true, startupCommand: "lazygit" },
              ],
              activeTerminalId: "sess-1",
            }),
          ],
        },
        version: 0,
      }),
    );
    vi.resetModules();
    const mod = await import("./workspaceStore");
    const s = mod.useWorkspaceStore.getState();
    expect(s.workspaces).toHaveLength(1);
    expect(s.workspaces[0].activeTerminalId).toBeNull();
    expect(s.workspaces[0].panes).toHaveLength(1);
    expect(s.workspaces[0].panes[0].sessionId).toBeUndefined();
    expect(s.workspaces[0].panes[0].cwd).toBe("/repo/a");
    expect(s.workspaces[0].panes[0].running).toBe(false);
  });

  it("does not restore workspaces when restoreSession is disabled", async () => {
    localStorage.setItem(
      "ai-terminal-agent-settings",
      JSON.stringify({
        state: {
          settings: { ...defaultSettings, restoreSession: false },
          workspaces: [ws({ name: "Persisted" })],
        },
        version: 0,
      }),
    );
    vi.resetModules();
    const mod = await import("./workspaceStore");
    const s = mod.useWorkspaceStore.getState();
    expect(s.workspaces).toHaveLength(1);
    expect(s.workspaces[0].name).not.toBe("Persisted");
  });
});

describe("reopenLastPane", () => {
  it("restores the most recently closed pane with its cwd", () => {
    store().addPane("w1", undefined);
    const p2 = w1().panes[1];
    useWorkspaceStore.setState((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === "w1"
          ? { ...w, panes: w.panes.map((p) => (p.id === p2.id ? { ...p, cwd: "/repo/x" } : p)) }
          : w,
      ),
    }));
    store().removePane(p2.id);
    expect(w1().panes).toHaveLength(1);
    store().reopenLastPane();
    expect(w1().panes).toHaveLength(2);
    expect(w1().panes[1].cwd).toBe("/repo/x");
    expect(w1().panes[1].id).not.toBe(p2.id);
  });

  it("does not reopen overlay panes", () => {
    store().addOverlayPane("lazygit", "lazygit", "w1");
    const overlay = w1().panes.find((p) => p.overlay)!;
    store().removePane(overlay.id);
    store().reopenLastPane();
    expect(w1().panes.some((p) => p.overlay)).toBe(false);
  });

  it("is a no-op when nothing was closed", () => {
    store().reopenLastPane();
    expect(w1().panes).toHaveLength(1);
  });
});

describe("pane titles and colors", () => {
  it("renamePane sets a title", () => {
    store().renamePane("p1", "claude", "w1");
    expect(w1().panes[0].title).toBe("claude");
  });

  it("renamePane can clear a title", () => {
    store().renamePane("p1", "claude", "w1");
    store().renamePane("p1", undefined, "w1");
    expect(w1().panes[0].title).toBeUndefined();
  });

  it("setPaneColor sets and clears a color", () => {
    store().setPaneColor("p1", "#22d3ee", "w1");
    expect(w1().panes[0].color).toBe("#22d3ee");
    store().setPaneColor("p1", undefined, "w1");
    expect(w1().panes[0].color).toBeUndefined();
  });

  it("setPaneRunning toggles the running flag", () => {
    store().setPaneRunning("p1", true, "w1");
    expect(w1().panes[0].running).toBe(true);
    store().setPaneRunning("p1", false, "w1");
    expect(w1().panes[0].running).toBe(false);
  });
});

describe("workspace templates", () => {
  it("saves the current workspace layout as a template", () => {
    store().addProject("/repo/a", "w1");
    store().addPane("w1", "npm run dev");
    store().saveWorkspaceTemplate("w1", "My Stack");
    expect(store().templates).toHaveLength(1);
    expect(store().templates[0].name).toBe("My Stack");
    expect(store().templates[0].projects).toEqual([{ root: "/repo/a" }]);
    expect(store().templates[0].panes.map((p) => p.startupCommand)).toContain(
      "npm run dev",
    );
  });

  it("excludes overlay panes from a saved template", () => {
    store().addOverlayPane("lazygit", "lazygit", "w1");
    store().saveWorkspaceTemplate("w1", "T");
    expect(store().templates[0].panes).toHaveLength(1);
  });

  it("creates a new workspace from a template", () => {
    store().addProject("/repo/a", "w1");
    store().addPane("w1", "npm run dev");
    store().saveWorkspaceTemplate("w1", "My Stack");
    const templateId = store().templates[0].id;
    store().createWorkspaceFromTemplate(templateId);
    expect(store().workspaces).toHaveLength(2);
    const created = store().workspaces[1];
    expect(created.name).toBe("My Stack");
    expect(created.projects.map((p) => p.root)).toEqual(["/repo/a"]);
    expect(created.panes.some((p) => p.startupCommand === "npm run dev")).toBe(true);
    expect(store().activeWorkspaceId).toBe(created.id);
  });

  it("removeWorkspaceTemplate deletes it", () => {
    store().saveWorkspaceTemplate("w1", "T");
    const id = store().templates[0].id;
    store().removeWorkspaceTemplate(id);
    expect(store().templates).toHaveLength(0);
  });
});
