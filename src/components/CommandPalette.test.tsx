import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CommandPalette } from "./CommandPalette";
import { defaultSettings, useWorkspaceStore } from "../store/workspaceStore";

const mocks = vi.hoisted(() => ({
  pickDirectory: vi.fn(async () => "/picked/dir"),
}));

vi.mock("../lib/tauri", () => ({
  pickDirectory: mocks.pickDirectory,
}));

function reset() {
  useWorkspaceStore.setState({
    workspaces: [
      {
        id: "w1",
        name: "W1",
        projects: [{ id: "pr1", root: "/repo" }],
        activeProjectId: "pr1",
        panes: [
          { id: "p1", type: "terminal", sessionId: "s1" },
          { id: "p2", type: "terminal", sessionId: "s2", title: "Server" },
        ],
        activeTerminalId: "s1",
      },
      { id: "w2", name: "W2", projects: [], activeProjectId: null, panes: [{ id: "p3", type: "terminal" }], activeTerminalId: null },
    ],
    activeWorkspaceId: "w1",
    settings: { ...defaultSettings },
    templates: [],
    closedPanes: [],
  });
}

const store = () => useWorkspaceStore.getState();

beforeEach(() => {
  localStorage.clear();
  reset();
  vi.clearAllMocks();
});

describe("CommandPalette", () => {
  it("lists actions and filters by query", () => {
    render(<CommandPalette onClose={() => {}} onOpenSettings={() => {}} />);
    expect(screen.getByText("New Terminal")).toBeInTheDocument();
    expect(screen.getByText(/Switch to Workspace: W2/)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Type a command…"), {
      target: { value: "settings" },
    });
    expect(screen.getByText("Open Settings")).toBeInTheDocument();
    expect(screen.queryByText("New Terminal")).not.toBeInTheDocument();
  });

  it("running New Terminal adds a pane and closes", () => {
    const onClose = vi.fn();
    render(<CommandPalette onClose={onClose} onOpenSettings={() => {}} />);
    fireEvent.click(screen.getByText("New Terminal"));
    expect(store().workspaces[0].panes).toHaveLength(3);
    expect(onClose).toHaveBeenCalled();
  });

  it("switching workspace via the palette activates it", () => {
    render(<CommandPalette onClose={() => {}} onOpenSettings={() => {}} />);
    fireEvent.click(screen.getByText(/Switch to Workspace: W2/));
    expect(store().activeWorkspaceId).toBe("w2");
  });

  it("jumping to a pane sets it active", () => {
    render(<CommandPalette onClose={() => {}} onOpenSettings={() => {}} />);
    fireEvent.click(screen.getByText("Jump to Server"));
    expect(store().workspaces[0].activeTerminalId).toBe("s2");
  });

  it("opening settings calls the callback", () => {
    const onOpenSettings = vi.fn();
    render(<CommandPalette onClose={() => {}} onOpenSettings={onOpenSettings} />);
    fireEvent.click(screen.getByText("Open Settings"));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it("add project opens a directory picker and adds the project", async () => {
    render(<CommandPalette onClose={() => {}} onOpenSettings={() => {}} />);
    fireEvent.click(screen.getByText("Add Project…"));
    await vi.waitFor(() =>
      expect(store().workspaces[0].projects.map((p) => p.root)).toContain(
        "/picked/dir",
      ),
    );
  });

  it("Escape closes the palette", () => {
    const onClose = vi.fn();
    render(<CommandPalette onClose={onClose} onOpenSettings={() => {}} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("backdrop click closes", () => {
    const onClose = vi.fn();
    const { container } = render(
      <CommandPalette onClose={onClose} onOpenSettings={() => {}} />,
    );
    fireEvent.click(container.firstChild as Element);
    expect(onClose).toHaveBeenCalled();
  });

  it("offers to reopen the last closed pane when one exists", () => {
    useWorkspaceStore.setState({
      closedPanes: [{ pane: { id: "old", type: "terminal" }, workspaceId: "w1" }],
    });
    render(<CommandPalette onClose={() => {}} onOpenSettings={() => {}} />);
    expect(screen.getByText("Reopen Last Closed Pane")).toBeInTheDocument();
  });

  it("offers to launch a saved template", () => {
    useWorkspaceStore.setState({
      templates: [{ id: "t1", name: "Stack", projects: [], panes: [] }],
    });
    render(<CommandPalette onClose={() => {}} onOpenSettings={() => {}} />);
    fireEvent.click(screen.getByText(/New Workspace from Template: Stack/));
    expect(store().workspaces).toHaveLength(3);
  });
});
