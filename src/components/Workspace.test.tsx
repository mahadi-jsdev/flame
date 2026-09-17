import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { Workspace } from "./Workspace";
import { defaultSettings, useWorkspaceStore } from "../store/workspaceStore";

const mountCounts = vi.hoisted(() => new Map<string, number>());

vi.mock("./TerminalPane", () => ({
  TerminalPane: ({ paneId }: { paneId: string }) => {
    useEffect(() => {
      mountCounts.set(paneId, (mountCounts.get(paneId) ?? 0) + 1);
    }, [paneId]);
    return <div data-testid="terminal-pane" />;
  },
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
    const isHidden = (label: string) =>
      screen.getByText(label).closest(".terminal-card")!.className.split(/\s+/).includes("hidden");

    expect(isHidden("web")).toBe(false);
    expect(isHidden("api")).toBe(true);

    act(() => {
      useWorkspaceStore.getState().setActiveProject("pr2", "w1");
    });
    expect(isHidden("web")).toBe(true);
    expect(isHidden("api")).toBe(false);
  });

  it("keeps a pane's terminal mounted (not remounted) when it's hidden and shown again", () => {
    mountCounts.clear();
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
                { id: "p1", type: "terminal" as const, projectId: "pr1" },
                { id: "p2", type: "terminal" as const, projectId: "pr2" },
              ],
            }
          : w,
      ),
    }));
    render(<Workspace />);
    // both panes mount immediately (p2 hidden), even though only p1 is shown
    expect(mountCounts.get("p1")).toBe(1);
    expect(mountCounts.get("p2")).toBe(1);

    act(() => {
      useWorkspaceStore.getState().setActiveProject("pr2", "w1");
    });
    act(() => {
      useWorkspaceStore.getState().setActiveProject("pr1", "w1");
    });
    // still mounted exactly once each — switching visibility never unmounted them
    expect(mountCounts.get("p1")).toBe(1);
    expect(mountCounts.get("p2")).toBe(1);
  });

  it("keeps a workspace's terminal mounted when you switch to another workspace and back", () => {
    mountCounts.clear();
    useWorkspaceStore.setState((s) => ({
      workspaces: [
        ...s.workspaces,
        {
          id: "w2",
          name: "Workspace 2",
          projects: [],
          activeProjectId: null,
          panes: [{ id: "p2", type: "terminal" }],
          activeTerminalId: null,
        },
      ],
      activeWorkspaceId: "w1",
    }));
    render(<Workspace />);
    expect(mountCounts.get("p1")).toBe(1);
    expect(mountCounts.get("p2")).toBe(1);

    act(() => {
      useWorkspaceStore.getState().setActiveWorkspace("w2");
    });
    act(() => {
      useWorkspaceStore.getState().setActiveWorkspace("w1");
    });
    expect(mountCounts.get("p1")).toBe(1);
    expect(mountCounts.get("p2")).toBe(1);
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

function setPaneCount(n: number) {
  const panes = Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    type: "terminal" as const,
  }));
  useWorkspaceStore.setState((s) => ({
    workspaces: s.workspaces.map((w) => (w.id === "w1" ? { ...w, panes } : w)),
  }));
}

// A backgrounded pane's title shows up twice (its own — hidden — card, and
// the tray chip that restores it), so this can't just be getByText().
function cardFor(title: string) {
  const card = screen
    .getAllByText(title)
    .map((el) => el.closest(".terminal-card"))
    .find((el): el is HTMLElement => el !== null);
  if (!card) throw new Error(`No .terminal-card found for "${title}"`);
  return card;
}

// Regression coverage for the exact bug class found in review: the vertical
// divider's row span was keyed off the wrong condition and bled through the
// full-width third pane at count===3. These pin down the CSS grid placement
// directly rather than relying on a screenshot to catch it again.
describe("resizable grid layout", () => {
  it("1 pane: no explicit placement, no divider", () => {
    setPaneCount(1);
    render(<Workspace />);
    const card = cardFor("Terminal 1");
    expect(card.style.gridColumn).toBe("");
    expect(card.style.gridRow).toBe("");
    expect(document.querySelector(".cursor-col-resize")).toBeNull();
    expect(document.querySelector(".cursor-row-resize")).toBeNull();
  });

  it("2 panes: side by side with one vertical divider spanning the single row", () => {
    setPaneCount(2);
    render(<Workspace />);
    expect(cardFor("Terminal 1").style.gridColumn).toBe("1");
    expect(cardFor("Terminal 1").style.gridRow).toBe("1");
    expect(cardFor("Terminal 2").style.gridColumn).toBe("3");
    expect(cardFor("Terminal 2").style.gridRow).toBe("1");

    const vDivider = document.querySelector(".cursor-col-resize") as HTMLElement;
    expect(vDivider).not.toBeNull();
    expect(vDivider.style.gridRow).toBe("1");
    expect(document.querySelector(".cursor-row-resize")).toBeNull();
  });

  it("3 panes: third spans the full bottom row, vertical divider stays confined to the top row", () => {
    setPaneCount(3);
    render(<Workspace />);
    expect(cardFor("Terminal 1").style.gridColumn).toBe("1");
    expect(cardFor("Terminal 1").style.gridRow).toBe("1");
    expect(cardFor("Terminal 2").style.gridColumn).toBe("3");
    expect(cardFor("Terminal 2").style.gridRow).toBe("1");
    expect(cardFor("Terminal 3").style.gridColumn).toBe("1 / 4");
    expect(cardFor("Terminal 3").style.gridRow).toBe("3");

    const vDivider = document.querySelector(".cursor-col-resize") as HTMLElement;
    // This is the regression: must be "1", NOT "1 / 4" — otherwise it cuts
    // straight through pane 3's full-width row.
    expect(vDivider.style.gridRow).toBe("1");

    const hDivider = document.querySelector(".cursor-row-resize") as HTMLElement;
    expect(hDivider).not.toBeNull();
    expect(hDivider.style.gridColumn).toBe("1 / 4");
    expect(hDivider.style.gridRow).toBe("2");
  });

  it("4 panes: even 2x2 grid, vertical divider spans both rows", () => {
    setPaneCount(4);
    render(<Workspace />);
    expect(cardFor("Terminal 1").style.gridColumn).toBe("1");
    expect(cardFor("Terminal 1").style.gridRow).toBe("1");
    expect(cardFor("Terminal 2").style.gridColumn).toBe("3");
    expect(cardFor("Terminal 2").style.gridRow).toBe("1");
    expect(cardFor("Terminal 3").style.gridColumn).toBe("1");
    expect(cardFor("Terminal 3").style.gridRow).toBe("3");
    expect(cardFor("Terminal 4").style.gridColumn).toBe("3");
    expect(cardFor("Terminal 4").style.gridRow).toBe("3");

    const vDivider = document.querySelector(".cursor-col-resize") as HTMLElement;
    expect(vDivider.style.gridRow).toBe("1 / 4");
  });

  it("5 panes: falls back to the plain wrapping grid, no explicit placement or dividers", () => {
    setPaneCount(5);
    render(<Workspace />);
    for (let i = 1; i <= 5; i++) {
      const card = cardFor(`Terminal ${i}`);
      expect(card.style.gridColumn).toBe("");
      expect(card.style.gridRow).toBe("");
    }
    expect(document.querySelector(".cursor-col-resize")).toBeNull();
    expect(document.querySelector(".cursor-row-resize")).toBeNull();
  });
});

describe("background and foreground", () => {
  it("sending a pane to the background hides its card and shows it in the tray", () => {
    setPaneCount(3);
    render(<Workspace />);
    fireEvent.click(
      cardFor("Terminal 2").querySelector('button[title="Send to background"]')!,
    );

    expect(cardFor("Terminal 2").className.split(/\s+/)).toContain("hidden");
    expect(screen.getByText("Background")).toBeInTheDocument();
    expect(
      screen.getByTitle("Bring to foreground").textContent,
    ).toContain("Terminal 2");
    expect(screen.getByText(/2 bays/)).toBeInTheDocument();
  });

  it("keeps the remaining panes' numbers stable instead of renumbering", () => {
    setPaneCount(3);
    render(<Workspace />);
    fireEvent.click(
      cardFor("Terminal 2").querySelector('button[title="Send to background"]')!,
    );
    expect(screen.getByText("Terminal 1")).toBeInTheDocument();
    expect(screen.getByText("Terminal 3")).toBeInTheDocument();
  });

  it("bringing a pane back to the foreground restores it to the grid and clears the tray", () => {
    setPaneCount(3);
    render(<Workspace />);
    fireEvent.click(
      cardFor("Terminal 2").querySelector('button[title="Send to background"]')!,
    );
    fireEvent.click(screen.getByTitle("Bring to foreground"));

    expect(cardFor("Terminal 2").className.split(/\s+/)).not.toContain("hidden");
    expect(screen.queryByText("Background")).not.toBeInTheDocument();
    expect(screen.getByText(/3 bays/)).toBeInTheDocument();
  });

  it("bringing a pane forward focuses it", () => {
    setPaneCount(2);
    act(() => {
      store().setSessionId("p2", "sess-2", "fish", "/repo", "w1");
    });
    render(<Workspace />);
    fireEvent.click(
      cardFor("Terminal 2").querySelector('button[title="Send to background"]')!,
    );
    fireEvent.click(screen.getByTitle("Bring to foreground"));
    expect(store().workspaces[0].activeTerminalId).toBe("sess-2");
  });

  it("never remounts the terminal while backgrounding or restoring it", () => {
    mountCounts.clear();
    setPaneCount(3);
    render(<Workspace />);
    fireEvent.click(
      cardFor("Terminal 2").querySelector('button[title="Send to background"]')!,
    );
    fireEvent.click(screen.getByTitle("Bring to foreground"));
    expect(mountCounts.get("p1")).toBe(1);
    expect(mountCounts.get("p2")).toBe(1);
    expect(mountCounts.get("p3")).toBe(1);
  });
});

describe("sidebar collapse", () => {
  it("Ctrl+B toggles the sidebar closed and back open", () => {
    render(<Workspace />);
    expect(screen.getByText("FLAME")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(screen.queryByText("FLAME")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(screen.getByText("FLAME")).toBeInTheDocument();
  });
});

describe("git panel collapse", () => {
  it("Ctrl+G toggles the git panel closed and back open", () => {
    render(<Workspace />);
    expect(screen.getByText("Changes")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "g", ctrlKey: true });
    expect(screen.queryByText("Changes")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "g", ctrlKey: true });
    expect(screen.getByText("Changes")).toBeInTheDocument();
  });

  it("persists independently of the left sidebar's collapsed state", () => {
    render(<Workspace />);
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(screen.getByText("Changes")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "g", ctrlKey: true });
    expect(screen.queryByText("FLAME")).not.toBeInTheDocument();
    expect(screen.queryByText("Changes")).not.toBeInTheDocument();
  });
});

describe("Ctrl+P file finder", () => {
  it("does nothing when no project is active", () => {
    render(<Workspace />);
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    expect(screen.queryByPlaceholderText("Go to file…")).not.toBeInTheDocument();
  });

  it("opens the file finder when a project is active", () => {
    useWorkspaceStore.setState((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === "w1"
          ? { ...w, projects: [{ id: "pr1", root: "/repo/a" }], activeProjectId: "pr1" }
          : w,
      ),
    }));
    render(<Workspace />);
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    expect(screen.getByPlaceholderText("Go to file…")).toBeInTheDocument();
  });
});
