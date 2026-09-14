import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import {
  defaultSettings,
  useWorkspaceStore,
} from "../store/workspaceStore";

function reset() {
  useWorkspaceStore.setState({
    workspaces: [
      {
        id: "w1",
        name: "Alpha",
        projects: [],
        activeProjectId: null,
        panes: [{ id: "p1", type: "terminal" }],
        activeTerminalId: null,
      },
      {
        id: "w2",
        name: "Beta",
        projects: [],
        activeProjectId: null,
        panes: [{ id: "p2", type: "terminal" }],
        activeTerminalId: null,
      },
    ],
    activeWorkspaceId: "w1",
    settings: defaultSettings,
    templates: [],
    closedPanes: [],
  });
}

const store = () => useWorkspaceStore.getState();

beforeEach(() => {
  localStorage.clear();
  reset();
});

describe("Sidebar", () => {
  it("lists all workspaces", () => {
    render(<Sidebar />);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("clicking a workspace activates it", () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByText("Beta"));
    expect(store().activeWorkspaceId).toBe("w2");
  });

  it("add button creates a workspace", () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByTitle("New workspace"));
    expect(store().workspaces).toHaveLength(3);
  });

  it("pencil opens inline rename, Enter commits", () => {
    render(<Sidebar />);
    const row = screen.getByText("Alpha").closest("div")!;
    fireEvent.mouseOver(row);
    const pencils = screen.getAllByTitle("Rename workspace");
    fireEvent.click(pencils[0]);
    const input = screen.getByDisplayValue("Alpha");
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(store().workspaces[0].name).toBe("Renamed");
  });

  it("double-click opens rename too", () => {
    render(<Sidebar />);
    fireEvent.doubleClick(screen.getByText("Alpha"));
    expect(screen.getByDisplayValue("Alpha")).toBeInTheDocument();
  });

  it("Escape cancels rename without applying", () => {
    render(<Sidebar />);
    fireEvent.doubleClick(screen.getByText("Alpha"));
    const input = screen.getByDisplayValue("Alpha");
    fireEvent.change(input, { target: { value: "Nope" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(store().workspaces[0].name).toBe("Alpha");
  });

  it("empty name is rejected on commit", () => {
    render(<Sidebar />);
    fireEvent.doubleClick(screen.getByText("Alpha"));
    const input = screen.getByDisplayValue("Alpha");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(store().workspaces[0].name).toBe("Alpha");
  });

  it("X removes a workspace when more than one exists", () => {
    render(<Sidebar />);
    const closes = screen.getAllByTitle("Close workspace");
    expect(closes.length).toBeGreaterThan(0);
    fireEvent.click(closes[0]);
    expect(store().workspaces).toHaveLength(1);
  });

  it("shows pane count chip per workspace", () => {
    render(<Sidebar />);
    const chips = screen.getAllByTitle(/terminal/);
    expect(chips.length).toBeGreaterThanOrEqual(2);
  });

  it("save as template prompts for a name and stores it", () => {
    vi.spyOn(window, "prompt").mockReturnValue("My Stack");
    render(<Sidebar />);
    fireEvent.click(screen.getAllByTitle("Save as template")[0]);
    expect(store().templates).toHaveLength(1);
    expect(store().templates[0].name).toBe("My Stack");
  });

  it("declining the prompt does not save a template", () => {
    vi.spyOn(window, "prompt").mockReturnValue(null);
    render(<Sidebar />);
    fireEvent.click(screen.getAllByTitle("Save as template")[0]);
    expect(store().templates).toHaveLength(0);
  });

  it("lists saved templates and launches a workspace from one", () => {
    store().saveWorkspaceTemplate("w1", "My Stack");
    render(<Sidebar />);
    expect(screen.getByText("My Stack")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Launch workspace from template"));
    expect(store().workspaces).toHaveLength(3);
  });

  it("deletes a template", () => {
    store().saveWorkspaceTemplate("w1", "My Stack");
    render(<Sidebar />);
    fireEvent.click(screen.getByTitle("Delete template"));
    expect(store().templates).toHaveLength(0);
  });
});

describe("Sidebar agent dashboard", () => {
  it("hides the Agents section when no panes are tagged", () => {
    render(<Sidebar />);
    expect(screen.queryByText("Agents")).not.toBeInTheDocument();
  });

  it("ignores panes with no title/color, and no running count when idle", () => {
    useWorkspaceStore.setState((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === "w1"
          ? { ...w, panes: [{ id: "p1", type: "terminal", title: undefined, color: undefined }] }
          : w,
      ),
    }));
    render(<Sidebar />);
    expect(screen.queryByText("Agents")).not.toBeInTheDocument();
  });

  it("shows a tagged pane with its project and workspace label", () => {
    useWorkspaceStore.setState((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === "w1"
          ? {
              ...w,
              projects: [{ id: "pr1", root: "/home/me/website-v2" }],
              panes: [
                {
                  id: "p1",
                  type: "terminal",
                  title: "claude",
                  color: "#ff8800",
                  projectId: "pr1",
                  sessionId: "s1",
                },
              ],
            }
          : w,
      ),
    }));
    render(<Sidebar />);
    expect(screen.getByText("Agents")).toBeInTheDocument();
    expect(screen.getByText("claude")).toBeInTheDocument();
    expect(screen.getByText("website-v2 · Alpha")).toBeInTheDocument();
    expect(screen.queryByText(/running$/)).not.toBeInTheDocument();
  });

  it("shows 'unscoped' for a tagged pane with no project", () => {
    useWorkspaceStore.setState((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === "w1"
          ? { ...w, panes: [{ id: "p1", type: "terminal", title: "devin", color: "#00ff88" }] }
          : w,
      ),
    }));
    render(<Sidebar />);
    expect(screen.getByText("unscoped · Alpha")).toBeInTheDocument();
  });

  it("shows a running count and lists running agents first", () => {
    useWorkspaceStore.setState((s) => ({
      workspaces: s.workspaces.map((w) => {
        if (w.id === "w1") {
          return {
            ...w,
            panes: [{ id: "p1", type: "terminal", title: "idle-one", color: "#fff", running: false }],
          };
        }
        if (w.id === "w2") {
          return {
            ...w,
            panes: [{ id: "p2", type: "terminal", title: "busy-one", color: "#fff", running: true }],
          };
        }
        return w;
      }),
    }));
    render(<Sidebar />);
    expect(screen.getByText("1 running")).toBeInTheDocument();
    const names = screen.getAllByText(/-one$/).map((el) => el.textContent);
    expect(names).toEqual(["busy-one", "idle-one"]);
  });

  it("shows a 'bg' badge for a backgrounded pane", () => {
    useWorkspaceStore.setState((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === "w1"
          ? {
              ...w,
              panes: [
                { id: "p1", type: "terminal", title: "claude", color: "#fff", backgrounded: true },
              ],
            }
          : w,
      ),
    }));
    render(<Sidebar />);
    expect(screen.getByText("bg")).toBeInTheDocument();
  });

  it("shows a 'needs input' count and badge for a waiting pane, and lists it first", () => {
    useWorkspaceStore.setState((s) => ({
      workspaces: s.workspaces.map((w) => {
        if (w.id === "w1") {
          return {
            ...w,
            panes: [{ id: "p1", type: "terminal", title: "busy-one", color: "#fff", running: true }],
          };
        }
        if (w.id === "w2") {
          return {
            ...w,
            panes: [
              {
                id: "p2",
                type: "terminal",
                title: "stuck-one",
                color: "#fff",
                waitingForInput: true,
              },
            ],
          };
        }
        return w;
      }),
    }));
    render(<Sidebar />);
    expect(screen.getByText("1 needs input")).toBeInTheDocument();
    expect(screen.getByText("needs input")).toBeInTheDocument();
    const names = screen.getAllByText(/-one$/).map((el) => el.textContent);
    expect(names).toEqual(["stuck-one", "busy-one"]);
  });

  it("hides the 'bg' badge in favor of 'needs input' when a pane is both", () => {
    useWorkspaceStore.setState((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === "w1"
          ? {
              ...w,
              panes: [
                {
                  id: "p1",
                  type: "terminal",
                  title: "claude",
                  color: "#fff",
                  backgrounded: true,
                  waitingForInput: true,
                },
              ],
            }
          : w,
      ),
    }));
    render(<Sidebar />);
    expect(screen.getByText("needs input")).toBeInTheDocument();
    expect(screen.queryByText("bg")).not.toBeInTheDocument();
  });

  it("clicking an entry jumps to its workspace, project, and terminal, and un-backgrounds it", () => {
    useWorkspaceStore.setState((s) => ({
      activeWorkspaceId: "w1",
      workspaces: s.workspaces.map((w) =>
        w.id === "w2"
          ? {
              ...w,
              projects: [{ id: "pr2", root: "/repo/api" }],
              panes: [
                {
                  id: "p2",
                  type: "terminal",
                  title: "claude",
                  color: "#fff",
                  projectId: "pr2",
                  sessionId: "s2",
                  backgrounded: true,
                },
              ],
            }
          : w,
      ),
    }));
    render(<Sidebar />);
    fireEvent.click(screen.getByText("claude"));
    expect(store().activeWorkspaceId).toBe("w2");
    expect(store().workspaces.find((w) => w.id === "w2")?.activeProjectId).toBe("pr2");
    expect(store().workspaces.find((w) => w.id === "w2")?.activeTerminalId).toBe("s2");
    expect(store().workspaces.find((w) => w.id === "w2")?.panes[0].backgrounded).toBe(false);
  });
});
