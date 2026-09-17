import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FileEditorDialog } from "./FileEditorDialog";

const mocks = vi.hoisted(() => ({
  gitDiffFile: vi.fn(async () => "diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new\n"),
  readTextFile: vi.fn(async () => "const x = 1;"),
  writeTextFile: vi.fn(async () => {}),
  readImageFile: vi.fn(async () => "data:image/png;base64,AAAA"),
}));

vi.mock("../lib/tauri", () => ({
  gitDiffFile: mocks.gitDiffFile,
  readTextFile: mocks.readTextFile,
  writeTextFile: mocks.writeTextFile,
  readImageFile: mocks.readImageFile,
}));

// CodeMirror's real contenteditable structure works in jsdom but isn't
// practical to drive via fireEvent (no plain value/onChange DOM contract) —
// stand in with a plain textarea carrying the same {value, onChange, path}
// contract so this file's own mode/dirty/save logic stays testable; the
// real syntax-highlighted rendering is verified in the browser instead.
vi.mock("./CodeEditor", () => ({
  CodeEditor: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (v: string) => void;
    path: string;
  }) => (
    <textarea
      data-testid="code-editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

const baseProps = {
  absPath: "/repo/src/a.ts",
  repoRoot: "/repo",
  relPath: "src/a.ts",
  status: " M",
  onClose: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FileEditorDialog", () => {
  it("loads and shows the diff by default for a tracked file", async () => {
    render(<FileEditorDialog {...baseProps} />);
    expect(await screen.findByText("+new")).toBeInTheDocument();
    expect(screen.getByText("-old")).toBeInTheDocument();
    expect(mocks.gitDiffFile).toHaveBeenCalledWith("/repo", "src/a.ts");
    expect(mocks.readTextFile).not.toHaveBeenCalled();
  });

  it("defaults to edit mode for an untracked file and skips the diff call", async () => {
    render(<FileEditorDialog {...baseProps} status="??" />);
    expect(await screen.findByDisplayValue("const x = 1;")).toBeInTheDocument();
    expect(mocks.gitDiffFile).not.toHaveBeenCalled();
  });

  it("hides the Diff/Edit toggle when status is unknown (opened via Ctrl+P)", async () => {
    const { status: _status, ...propsWithoutStatus } = baseProps;
    render(<FileEditorDialog {...propsWithoutStatus} />);
    expect(await screen.findByDisplayValue("const x = 1;")).toBeInTheDocument();
    expect(screen.queryByText("Diff")).not.toBeInTheDocument();
    expect(screen.queryByText("Edit")).not.toBeInTheDocument();
    expect(mocks.gitDiffFile).not.toHaveBeenCalled();
  });

  it("switches to edit mode and loads file content on demand", async () => {
    render(<FileEditorDialog {...baseProps} />);
    await screen.findByText("+new");
    fireEvent.click(screen.getByText("Edit"));
    expect(await screen.findByDisplayValue("const x = 1;")).toBeInTheDocument();
    expect(mocks.readTextFile).toHaveBeenCalledWith("/repo/src/a.ts");
  });

  it("shows a dirty indicator once the content is edited, and saves it", async () => {
    render(<FileEditorDialog {...baseProps} status="??" />);
    const textarea = await screen.findByDisplayValue("const x = 1;");
    expect(screen.getByTitle("Save (Ctrl+S)")).toBeDisabled();

    fireEvent.change(textarea, { target: { value: "const x = 2;" } });
    expect(screen.getByTitle("Unsaved changes")).toBeInTheDocument();
    expect(screen.getByTitle("Save (Ctrl+S)")).not.toBeDisabled();

    fireEvent.click(screen.getByTitle("Save (Ctrl+S)"));
    await waitFor(() =>
      expect(mocks.writeTextFile).toHaveBeenCalledWith("/repo/src/a.ts", "const x = 2;"),
    );
    await waitFor(() => expect(screen.queryByTitle("Unsaved changes")).not.toBeInTheDocument());
  });

  it("saves on Ctrl+S while editing", async () => {
    render(<FileEditorDialog {...baseProps} status="??" />);
    const textarea = await screen.findByDisplayValue("const x = 1;");
    fireEvent.change(textarea, { target: { value: "edited" } });
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() =>
      expect(mocks.writeTextFile).toHaveBeenCalledWith("/repo/src/a.ts", "edited"),
    );
  });

  it("surfaces a write error instead of silently losing the edit", async () => {
    mocks.writeTextFile.mockRejectedValueOnce(new Error("disk full"));
    render(<FileEditorDialog {...baseProps} status="??" />);
    const textarea = await screen.findByDisplayValue("const x = 1;");
    fireEvent.change(textarea, { target: { value: "edited" } });
    fireEvent.click(screen.getByTitle("Save (Ctrl+S)"));
    expect(await screen.findByText(/disk full/)).toBeInTheDocument();
  });

  it("Escape closes the dialog", async () => {
    const onClose = vi.fn();
    render(<FileEditorDialog {...baseProps} onClose={onClose} />);
    await screen.findByText("+new");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("clicking the backdrop closes the dialog, clicking inside does not", async () => {
    const onClose = vi.fn();
    const { container } = render(<FileEditorDialog {...baseProps} onClose={onClose} />);
    await screen.findByText("+new");
    fireEvent.click(screen.getByText("+new"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(container.firstElementChild!);
    expect(onClose).toHaveBeenCalled();
  });

  it("shows a friendly message when switching to diff view for a new file, without calling the backend", async () => {
    render(<FileEditorDialog {...baseProps} status="??" />);
    await screen.findByDisplayValue("const x = 1;");
    fireEvent.click(screen.getByText("Diff"));
    expect(await screen.findByText("New file — nothing to diff yet.")).toBeInTheDocument();
    expect(mocks.gitDiffFile).not.toHaveBeenCalled();
  });
});

describe("FileEditorDialog image preview", () => {
  const imageProps = {
    absPath: "/repo/assets/logo.png",
    repoRoot: "/repo",
    relPath: "assets/logo.png",
    status: " M",
    onClose: vi.fn(),
  };

  it("renders the decoded image instead of the diff/edit views", async () => {
    render(<FileEditorDialog {...imageProps} />);
    const img = await screen.findByAltText("logo.png");
    expect(img).toHaveAttribute("src", "data:image/png;base64,AAAA");
    expect(mocks.readImageFile).toHaveBeenCalledWith("/repo/assets/logo.png");
    expect(mocks.gitDiffFile).not.toHaveBeenCalled();
    expect(mocks.readTextFile).not.toHaveBeenCalled();
  });

  it("hides the Diff/Edit toggle and Save button for images", async () => {
    render(<FileEditorDialog {...imageProps} />);
    await screen.findByAltText("logo.png");
    expect(screen.queryByText("Diff")).not.toBeInTheDocument();
    expect(screen.queryByText("Edit")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Save (Ctrl+S)")).not.toBeInTheDocument();
  });

  it("surfaces an error instead of a blank pane when the image fails to load", async () => {
    mocks.readImageFile.mockRejectedValueOnce(new Error("image is too large to preview"));
    render(<FileEditorDialog {...imageProps} />);
    expect(await screen.findByText(/too large to preview/)).toBeInTheDocument();
  });
});
