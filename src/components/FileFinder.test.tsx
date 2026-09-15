import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FileFinder } from "./FileFinder";

const mocks = vi.hoisted(() => ({
  gitRoot: vi.fn(async () => "/repo"),
  listProjectFiles: vi.fn(async () => [
    "src/components/GitPanel.tsx",
    "src/components/FileEditorDialog.tsx",
    "README.md",
    "package.json",
  ]),
}));

vi.mock("../lib/tauri", () => ({
  gitRoot: mocks.gitRoot,
  listProjectFiles: mocks.listProjectFiles,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gitRoot.mockResolvedValue("/repo");
  mocks.listProjectFiles.mockResolvedValue([
    "src/components/GitPanel.tsx",
    "src/components/FileEditorDialog.tsx",
    "README.md",
    "package.json",
  ]);
});

describe("FileFinder", () => {
  it("loads and lists project files, resolving the real git root", async () => {
    render(<FileFinder projectRoot="/repo/sub" onOpenFile={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText("GitPanel.tsx")).toBeInTheDocument();
    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(mocks.listProjectFiles).toHaveBeenCalledWith("/repo/sub");
    expect(mocks.gitRoot).toHaveBeenCalledWith("/repo/sub");
  });

  it("filters by fuzzy match as you type", async () => {
    render(<FileFinder projectRoot="/repo" onOpenFile={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText("GitPanel.tsx");
    fireEvent.change(screen.getByPlaceholderText("Go to file…"), {
      target: { value: "gpanel" },
    });
    expect(screen.getByText("GitPanel.tsx")).toBeInTheDocument();
    expect(screen.queryByText("README.md")).not.toBeInTheDocument();
  });

  it("shows a 'no matching files' state for a query that matches nothing", async () => {
    render(<FileFinder projectRoot="/repo" onOpenFile={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText("GitPanel.tsx");
    fireEvent.change(screen.getByPlaceholderText("Go to file…"), {
      target: { value: "zzzzz" },
    });
    expect(screen.getByText("No matching files")).toBeInTheDocument();
  });

  it("clicking a file opens it with the absolute path resolved against the real git root", async () => {
    mocks.gitRoot.mockResolvedValue("/real/repo/root");
    const onOpenFile = vi.fn();
    const onClose = vi.fn();
    render(<FileFinder projectRoot="/repo/sub" onOpenFile={onOpenFile} onClose={onClose} />);
    fireEvent.click(await screen.findByText("README.md"));
    expect(onOpenFile).toHaveBeenCalledWith({
      absPath: "/real/repo/root/README.md",
      repoRoot: "/real/repo/root",
      relPath: "README.md",
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("Enter opens the currently selected result", async () => {
    const onOpenFile = vi.fn();
    render(<FileFinder projectRoot="/repo" onOpenFile={onOpenFile} onClose={vi.fn()} />);
    await screen.findByText("GitPanel.tsx");
    const input = screen.getByPlaceholderText("Go to file…");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onOpenFile).toHaveBeenCalledWith(
      expect.objectContaining({ relPath: "src/components/GitPanel.tsx" }),
    );
  });

  it("ArrowDown moves the selection to the next result before Enter", async () => {
    const onOpenFile = vi.fn();
    render(<FileFinder projectRoot="/repo" onOpenFile={onOpenFile} onClose={vi.fn()} />);
    await screen.findByText("GitPanel.tsx");
    const input = screen.getByPlaceholderText("Go to file…");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onOpenFile).toHaveBeenCalledWith(
      expect.objectContaining({ relPath: "src/components/FileEditorDialog.tsx" }),
    );
  });

  it("Escape closes the finder", async () => {
    const onClose = vi.fn();
    render(<FileFinder projectRoot="/repo" onOpenFile={vi.fn()} onClose={onClose} />);
    await screen.findByText("GitPanel.tsx");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("clicking the backdrop closes, clicking inside the dialog does not", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <FileFinder projectRoot="/repo" onOpenFile={vi.fn()} onClose={onClose} />,
    );
    await screen.findByText("GitPanel.tsx");
    fireEvent.click(screen.getByText("GitPanel.tsx").closest("div")!.parentElement!);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(container.firstElementChild!);
    expect(onClose).toHaveBeenCalled();
  });

  it("surfaces an error instead of hanging silently", async () => {
    mocks.listProjectFiles.mockRejectedValueOnce(new Error("not a directory"));
    render(<FileFinder projectRoot="/repo" onOpenFile={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText(/not a directory/)).toBeInTheDocument();
  });

  it("re-indexes when the project root prop changes", async () => {
    const { rerender } = render(
      <FileFinder projectRoot="/repo-a" onOpenFile={vi.fn()} onClose={vi.fn()} />,
    );
    await waitFor(() => expect(mocks.listProjectFiles).toHaveBeenCalledWith("/repo-a"));
    rerender(<FileFinder projectRoot="/repo-b" onOpenFile={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(mocks.listProjectFiles).toHaveBeenCalledWith("/repo-b"));
  });
});
