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
    todos: [],
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
