import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GitPanel } from "./GitPanel";
import {
  defaultSettings,
  useWorkspaceStore,
} from "../store/workspaceStore";

const mocks = vi.hoisted(() => ({
  gitStatus: vi.fn(async () => [
    { status: " M", path: "src/a.ts", original_path: null },
    { status: "??", path: "new.txt", original_path: null },
  ]),
  gitBranch: vi.fn(async () => "main"),
  gitBranches: vi.fn(async () => ["main", "dev"]),
  gitCheckout: vi.fn(async () => {}),
  gitRoot: vi.fn(async () => "/repo"),
  gitAutoCommit: vi.fn(async () => "feat: add the thing"),
}));

vi.mock("../lib/tauri", () => ({
  GitStatusEntry: undefined,
  gitStatus: mocks.gitStatus,
  gitBranch: mocks.gitBranch,
  gitBranches: mocks.gitBranches,
  gitCheckout: mocks.gitCheckout,
  gitRoot: mocks.gitRoot,
  gitAutoCommit: mocks.gitAutoCommit,
}));

function reset() {
  useWorkspaceStore.setState({
    workspaces: [
      {
        id: "w1",
        name: "W1",
        projects: [{ id: "pr1", root: "/repo" }],
        activeProjectId: "pr1",
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

describe("GitPanel", () => {
  it("renders branch name and changed files", async () => {
    render(<GitPanel />);
    expect(await screen.findByText("main")).toBeInTheDocument();
    expect(await screen.findByText("a.ts")).toBeInTheDocument();
    expect(screen.getByText("new.txt")).toBeInTheDocument();
  });

  it("shows an empty state when no project is active", () => {
    useWorkspaceStore.setState((s) => ({
      workspaces: s.workspaces.map((w) => ({ ...w, activeProjectId: null })),
    }));
    render(<GitPanel />);
    expect(screen.getByText(/Select or add a project/)).toBeInTheDocument();
  });

  it("clicking a file opens an overlay pane with the diff", async () => {
    render(<GitPanel />);
    const row = await screen.findByText("a.ts");
    fireEvent.click(row);
    const overlay = store().workspaces[0].panes.find((p) => p.overlay);
    expect(overlay).toBeDefined();
    expect(overlay!.title).toBe("diff: a.ts");
    expect(overlay!.startupCommand).toContain("git -C");
    expect(overlay!.startupCommand).toContain("a.ts");
  });

  it("branch dropdown lists branches and switches", async () => {
    render(<GitPanel />);
    fireEvent.click(await screen.findByText("main"));
    const dev = await screen.findByText("dev");
    fireEvent.click(dev);
    expect(mocks.gitCheckout).toHaveBeenCalledWith("/repo", "dev");
  });

  it("lazygit button opens overlay with lazygit", async () => {
    render(<GitPanel />);
    fireEvent.click(
      await screen.findByTitle("Open lazygit in a new terminal"),
    );
    const overlay = store().workspaces[0].panes.find((p) => p.overlay);
    expect(overlay?.title).toBe("lazygit");
    expect(overlay?.startupCommand).toContain("lazygit -p '/repo'");
  });

  it("auto-commit without a configured key surfaces the backend error", async () => {
    mocks.gitAutoCommit.mockRejectedValueOnce(
      new Error("no OpenAI API key configured — set one in Settings"),
    );
    render(<GitPanel />);
    fireEvent.click(
      await screen.findByTitle("AI auto-commit (stages all changes)"),
    );
    expect(
      await screen.findByText(/no OpenAI API key configured/),
    ).toBeInTheDocument();
    expect(mocks.gitAutoCommit).toHaveBeenCalledWith("/repo", "gpt-4o-mini");
  });

  it("auto-commit commits and shows the message", async () => {
    render(<GitPanel />);
    fireEvent.click(
      await screen.findByTitle("AI auto-commit (stages all changes)"),
    );
    expect(await screen.findByText("feat: add the thing")).toBeInTheDocument();
    expect(mocks.gitAutoCommit).toHaveBeenCalledWith("/repo", "gpt-4o-mini");
    expect(mocks.gitStatus).toHaveBeenCalled(); // refresh after commit
  });

  it("auto-commit failure surfaces the error", async () => {
    mocks.gitAutoCommit.mockRejectedValueOnce(new Error("OpenAI HTTP 401"));
    render(<GitPanel />);
    fireEvent.click(
      await screen.findByTitle("AI auto-commit (stages all changes)"),
    );
    expect(
      await screen.findByText(/OpenAI HTTP 401/),
    ).toBeInTheDocument();
  });
});
