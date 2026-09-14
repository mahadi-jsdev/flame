import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TodoList } from "./TodoList";
import { defaultSettings, useWorkspaceStore } from "../store/workspaceStore";

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

describe("TodoList", () => {
  it("adds a todo on Enter and clears the input", () => {
    render(<TodoList />);
    const input = screen.getByPlaceholderText(/Add a todo/);
    fireEvent.change(input, { target: { value: "write the changelog" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("write the changelog")).toBeInTheDocument();
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("shows the parsed tag as a chip, stripped from the text", () => {
    render(<TodoList />);
    const input = screen.getByPlaceholderText(/Add a todo/);
    fireEvent.change(input, {
      target: { value: "fix login #ai-terminal-agent" },
    });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("fix login")).toBeInTheDocument();
    expect(screen.getByText("#ai-terminal-agent")).toBeInTheDocument();
  });

  it("does not add an empty todo", () => {
    render(<TodoList />);
    const input = screen.getByPlaceholderText(/Add a todo/);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(store().todos).toHaveLength(0);
  });

  it("clicking the checkbox toggles done and strikes through the text", () => {
    store().addTodo("ship it");
    render(<TodoList />);
    fireEvent.click(screen.getByTitle("Mark done"));
    expect(store().todos[0].done).toBe(true);
    expect(screen.getByText("ship it").className).toContain("line-through");
  });

  it("delete removes the todo", () => {
    store().addTodo("throwaway");
    render(<TodoList />);
    fireEvent.click(screen.getByTitle("Delete todo"));
    expect(store().todos).toHaveLength(0);
  });

  it("keeps incomplete todos above done ones", () => {
    store().addTodo("first");
    store().addTodo("second");
    store().toggleTodo(store().todos[1].id); // "first" is index 1 (unshifted)
    render(<TodoList />);
    const rendered = screen.getAllByText(/first|second/).map((el) => el.textContent);
    expect(rendered).toEqual(["second", "first"]);
  });
});
