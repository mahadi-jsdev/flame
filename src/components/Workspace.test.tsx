import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Workspace } from "./Workspace";
import { defaultSettings, useWorkspaceStore } from "../store/workspaceStore";

vi.mock("./TerminalPane", () => ({
  TerminalPane: () => <div data-testid="terminal-pane" />,
}));

function reset() {
  useWorkspaceStore.setState({
    workspaces: [
      {
        id: "w1",
        name: "Workspace 1",
        projects: [],
        activeProjectId: null,
        panes: [{ id: "p1", type: "terminal" }],
        activeTerminalId: null,
      },
    ],
    activeWorkspaceId: null,
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

describe("Workspace shell", () => {
  it("renders workspace name and terminal count", () => {
    render(<Workspace />);
    // name appears in header and sidebar row
    expect(screen.getAllByText("Workspace 1").length).toBeGreaterThan(0);
    expect(screen.getByText(/1 bay/)).toBeInTheDocument();
  });

  it("renders one pane header per pane", () => {
    store().addPane("w1");
    render(<Workspace />);
    expect(screen.getByText("Terminal 1")).toBeInTheDocument();
    expect(screen.getByText("Terminal 2")).toBeInTheDocument();
  });

  it("New Bay button adds a pane", () => {
    render(<Workspace />);
    fireEvent.click(screen.getByText("New Bay"));
    expect(store().workspaces[0].panes).toHaveLength(2);
  });

  it("Ctrl+Shift+T adds a pane", () => {
    render(<Workspace />);
    fireEvent.keyDown(window, { key: "t", ctrlKey: true, shiftKey: true });
    expect(store().workspaces[0].panes).toHaveLength(2);
  });

  it("plain keypress does not add a pane", () => {
    render(<Workspace />);
    fireEvent.keyDown(window, { key: "t" });
    expect(store().workspaces[0].panes).toHaveLength(1);
  });

  it("close button removes a pane (keeping at least one)", () => {
    store().addPane("w1");
    render(<Workspace />);
    const closes = screen.getAllByTitle("Close terminal");
    fireEvent.click(closes[0]);
    expect(store().workspaces[0].panes).toHaveLength(1);
  });

  it("renders overlay pane as popup with title and Close", () => {
    store().addOverlayPane("lazygit -p /x", "lazygit", "w1");
    render(<Workspace />);
    expect(screen.getByText("lazygit")).toBeInTheDocument();
    expect(screen.getByTitle("Close")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Close"));
    expect(store().workspaces[0].panes.filter((p) => p.overlay)).toHaveLength(
      0,
    );
  });

  it("drag start then drop swaps pane order", () => {
    store().addPane("w1");
    render(<Workspace />);
    const [t1, t2] = store().workspaces[0].panes.map((p) => p.id);

    const h1 = screen.getByText("Terminal 1").closest("[draggable]")!;
    const card2 = screen.getByText("Terminal 2").closest(".terminal-card")!;

    const dt = {
      data: {} as Record<string, string>,
      setData(k: string, v: string) {
        this.data[k] = v;
      },
      getData(k: string) {
        return this.data[k];
      },
      effectAllowed: "",
      dropEffect: "",
    };
    fireEvent.dragStart(h1, { dataTransfer: dt });
    fireEvent.drop(card2, { dataTransfer: dt });

    const ids = store().workspaces[0].panes.map((p) => p.id);
    expect(ids).toEqual([t2, t1]);
  });

  it("shows shell chip and cwd for spawned panes", () => {
    useWorkspaceStore.setState((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === "w1"
          ? {
              ...w,
              panes: [
                {
                  id: "p1",
                  type: "terminal" as const,
                  sessionId: "s1",
                  shell: "fish",
                  cwd: "/home/u/projects/myproj",
                },
              ],
            }
          : w,
      ),
    }));
    render(<Workspace />);
    expect(screen.getByTitle("Shell: fish")).toBeInTheDocument();
    expect(screen.getByText("fish")).toBeInTheDocument();
    expect(screen.getByTitle("/home/u/projects/myproj")).toBeInTheDocument();
    expect(screen.getByText("myproj")).toBeInTheDocument();
  });

  it("hides cwd chip when pane has no cwd", () => {
    render(<Workspace />);
    expect(screen.queryByTitle(/^\//)).not.toBeInTheDocument();
  });

  it("settings gear opens dialog", () => {
    render(<Workspace />);
    fireEvent.click(screen.getByTitle("Settings"));
    expect(screen.getByText("Font size")).toBeInTheDocument();
  });

  it("footer shows system status", () => {
    render(<Workspace />);
    expect(screen.getByText(/SYSTEM NOMINAL/)).toBeInTheDocument();
  });

  it("Ctrl+K opens the command palette", () => {
    render(<Workspace />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByPlaceholderText("Type a command…")).toBeInTheDocument();
  });

  it("Commands button opens the command palette", () => {
    render(<Workspace />);
    fireEvent.click(screen.getByTitle("Command palette"));
    expect(screen.getByPlaceholderText("Type a command…")).toBeInTheDocument();
  });

  it("Ctrl+Shift+E reopens the last closed pane", () => {
    store().addPane("w1");
    render(<Workspace />);
    const closes = screen.getAllByTitle("Close terminal");
    fireEvent.click(closes[0]);
    expect(store().workspaces[0].panes).toHaveLength(1);
    fireEvent.keyDown(window, { key: "e", ctrlKey: true, shiftKey: true });
    expect(store().workspaces[0].panes).toHaveLength(2);
  });

  it("double-click on a pane label renames it", () => {
    render(<Workspace />);
    fireEvent.doubleClick(screen.getByText("Terminal 1"));
    const input = screen.getByDisplayValue("Terminal 1");
    fireEvent.change(input, { target: { value: "Server" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(store().workspaces[0].panes[0].title).toBe("Server");
    expect(screen.getByText("Server")).toBeInTheDocument();
  });

  it("clicking the color dot cycles the pane's tag color", () => {
    render(<Workspace />);
    const dot = screen.getByTitle("Click to cycle tag color");
    fireEvent.click(dot);
    expect(store().workspaces[0].panes[0].color).toBe("#ffb238");
  });

  it("Ctrl+1 jumps to the first pane with a session", () => {
    useWorkspaceStore.setState((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === "w1"
          ? {
              ...w,
              panes: [
                { id: "p1", type: "terminal" as const, sessionId: "s1" },
                { id: "p2", type: "terminal" as const, sessionId: "s2" },
              ],
              activeTerminalId: "s2",
            }
          : w,
      ),
    }));
    render(<Workspace />);
    fireEvent.keyDown(window, { key: "1", ctrlKey: true });
    expect(store().workspaces[0].activeTerminalId).toBe("s1");
  });

  it("shows a running badge for a busy pane and idle for a quiet one", () => {
    useWorkspaceStore.setState((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === "w1"
          ? {
              ...w,
              panes: [
                { id: "p1", type: "terminal" as const, sessionId: "s1", running: true },
                { id: "p2", type: "terminal" as const, sessionId: "s2", running: false },
              ],
            }
          : w,
      ),
    }));
    render(<Workspace />);
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("idle")).toBeInTheDocument();
  });

  it("shows no status badge for a pane that hasn't spawned a session yet", () => {
    render(<Workspace />);
    expect(screen.queryByText("running")).not.toBeInTheDocument();
    expect(screen.queryByText("idle")).not.toBeInTheDocument();
  });

  it("header reports the live pane count", () => {
    useWorkspaceStore.setState((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === "w1"
          ? {
              ...w,
              panes: [
                { id: "p1", type: "terminal" as const, sessionId: "s1", running: true },
                { id: "p2", type: "terminal" as const, sessionId: "s2", running: false },
              ],
            }
          : w,
      ),
    }));
    render(<Workspace />);
    expect(screen.getByText(/2 bays · 1 live/)).toBeInTheDocument();
  });

  it("only shows panes belonging to the active project", () => {
    useWorkspaceStore.setState((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === "w1"
          ? {
              ...w,
              projects: [
                { id: "pr1", root: "/repo/a" },
                { id: "pr2", root: "/repo/b" },
              ],
              activeProjectId: "pr1",
              panes: [
                { id: "p1", type: "terminal" as const, projectId: "pr1", title: "web" },
                { id: "p2", type: "terminal" as const, projectId: "pr2", title: "api" },
              ],
            }
          : w,
      ),
    }));
    render(<Workspace />);
    expect(screen.getByText("web")).toBeInTheDocument();
    expect(screen.queryByText("api")).not.toBeInTheDocument();

    act(() => {
      useWorkspaceStore.getState().setActiveProject("pr2", "w1");
    });
    expect(screen.getByText("api")).toBeInTheDocument();
    expect(screen.queryByText("web")).not.toBeInTheDocument();
  });

  it("switching to a project with no panes auto-creates one", () => {
    useWorkspaceStore.setState((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === "w1"
          ? {
              ...w,
              projects: [{ id: "pr1", root: "/repo/a" }],
              activeProjectId: null,
              panes: [{ id: "p1", type: "terminal" as const }],
            }
          : w,
      ),
    }));
    render(<Workspace />);
    act(() => {
      useWorkspaceStore.getState().setActiveProject("pr1", "w1");
    });
    const scoped = store().workspaces[0].panes.filter((p) => p.projectId === "pr1");
    expect(scoped).toHaveLength(1);
  });
});
