import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ProjectPanel } from "./ProjectPanel";
import { defaultSettings, useWorkspaceStore } from "../store/workspaceStore";

const mocks = vi.hoisted(() => ({
  pickDirectory: vi.fn(async (): Promise<string | null> => "/picked/dir"),
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
        projects: [],
        activeProjectId: null,
        panes: [{ id: "p1", type: "terminal" }],
        activeTerminalId: null,
      },
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

describe("ProjectPanel", () => {
  it("shows an empty state with no projects", () => {
    render(<ProjectPanel />);
    expect(screen.getByText("No projects yet")).toBeInTheDocument();
  });

  it("adding a project via the empty state calls pickDirectory and stores it", async () => {
    render(<ProjectPanel />);
    fireEvent.click(screen.getByText("Add Project"));
    await vi.waitFor(() =>
      expect(store().workspaces[0].projects.map((p) => p.root)).toContain(
        "/picked/dir",
      ),
    );
  });

  it("adding via the header plus button also works", async () => {
    render(<ProjectPanel />);
    fireEvent.click(screen.getByTitle("Add project"));
    await vi.waitFor(() =>
      expect(store().workspaces[0].projects).toHaveLength(1),
    );
  });

  it("declining the directory picker adds nothing", async () => {
    mocks.pickDirectory.mockResolvedValueOnce(null);
    render(<ProjectPanel />);
    fireEvent.click(screen.getByTitle("Add project"));
    await vi.waitFor(() => expect(mocks.pickDirectory).toHaveBeenCalled());
    expect(store().workspaces[0].projects).toHaveLength(0);
  });

  it("lists projects and marks the active one", () => {
    useWorkspaceStore.setState((s) => ({
      workspaces: s.workspaces.map((w) => ({
        ...w,
        projects: [
          { id: "pr1", root: "/repo/agent-web" },
          { id: "pr2", root: "/repo/billing-service" },
        ],
        activeProjectId: "pr1",
      })),
    }));
    render(<ProjectPanel />);
    expect(screen.getByText("agent-web")).toBeInTheDocument();
    expect(screen.getByText("billing-service")).toBeInTheDocument();
  });

  it("clicking a project makes it active", () => {
    useWorkspaceStore.setState((s) => ({
      workspaces: s.workspaces.map((w) => ({
        ...w,
        projects: [
          { id: "pr1", root: "/repo/agent-web" },
          { id: "pr2", root: "/repo/billing-service" },
        ],
        activeProjectId: "pr1",
      })),
    }));
    render(<ProjectPanel />);
    fireEvent.click(screen.getByText("billing-service"));
    expect(store().workspaces[0].activeProjectId).toBe("pr2");
  });

  it("removes a project when more than one exists", () => {
    useWorkspaceStore.setState((s) => ({
      workspaces: s.workspaces.map((w) => ({
        ...w,
        projects: [
          { id: "pr1", root: "/repo/agent-web" },
          { id: "pr2", root: "/repo/billing-service" },
        ],
        activeProjectId: "pr1",
      })),
    }));
    render(<ProjectPanel />);
    fireEvent.click(screen.getAllByTitle("Remove project")[0]);
    expect(store().workspaces[0].projects).toHaveLength(1);
  });

  it("hides the remove button when only one project exists", () => {
    useWorkspaceStore.setState((s) => ({
      workspaces: s.workspaces.map((w) => ({
        ...w,
        projects: [{ id: "pr1", root: "/repo/agent-web" }],
        activeProjectId: "pr1",
      })),
    }));
    render(<ProjectPanel />);
    expect(screen.queryByTitle("Remove project")).not.toBeInTheDocument();
  });
});
