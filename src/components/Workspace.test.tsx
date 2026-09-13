import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
    expect(screen.getByText(/1 terminal/)).toBeInTheDocument();
  });

  it("renders one pane header per pane", () => {
    store().addPane("w1");
    render(<Workspace />);
    expect(screen.getByText("Terminal 1")).toBeInTheDocument();
    expect(screen.getByText("Terminal 2")).toBeInTheDocument();
  });

  it("New Terminal button adds a pane", () => {
    render(<Workspace />);
    fireEvent.click(screen.getByText("New Terminal"));
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

  it("footer shows PTY ready status", () => {
    render(<Workspace />);
    expect(screen.getByText(/PTY engine ready/)).toBeInTheDocument();
  });
});
