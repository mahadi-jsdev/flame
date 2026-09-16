import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { Extension } from "@codemirror/state";
import { CodeEditor } from "./CodeEditor";

/** Sentinel standing in for the extension array `languageServerWithTransport`
 * really returns, so a test can tell "the LSP extensions were wired into
 * CodeMirror" apart from "the ordinary highlighting extensions were". */
const LSP_EXTENSION = "lsp-extension-sentinel" as unknown as Extension;

const mocks = vi.hoisted(() => ({
  getLspSession: vi.fn(async (_root: string, _uri: string, _lang: string) => ({
    client: { ready: true },
    transport: { close: () => {} },
  }) as unknown),
  languageServerWithTransport: vi.fn((_options: Record<string, unknown>) => [
    "lsp-extension-sentinel",
  ]),
}));

// Only `languageServerWithTransport` is used by CodeEditor; mocking it keeps
// a real LSP client (and its initialize handshake) out of these tests.
vi.mock("codemirror-languageserver", () => ({
  languageServerWithTransport: mocks.languageServerWithTransport,
}));

vi.mock("../lib/lspClient", () => ({
  getLspSession: mocks.getLspSession,
  // Deliberately simpler than the real thing — pathToFileUri's own escaping
  // rules are covered in lspClient.test.ts; here it just has to make the
  // expected URIs obvious at the assertion site.
  pathToFileUri: (absPath: string) => `file://${absPath}`,
}));

// CodeMirror's real rendering isn't what's under test here (and fights jsdom),
// so stand it in with a plain textarea — the same convention FileEditorDialog's
// tests use for CodeEditor itself. The stub surfaces whether the LSP extensions
// made it into the extension list.
vi.mock("@uiw/react-codemirror", () => ({
  default: ({
    value,
    onChange,
    extensions,
  }: {
    value: string;
    onChange: (v: string) => void;
    extensions: Extension[];
  }) => (
    <textarea
      data-testid="code-mirror"
      data-lsp-wired={String(extensions.includes(LSP_EXTENSION))}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

const baseProps = {
  value: "const x = 1;",
  onChange: vi.fn(),
  path: "src/a.ts",
  absPath: "/repo/src/a.ts",
  projectRoot: "/repo",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getLspSession.mockResolvedValue({
    client: { ready: true },
    transport: { close: () => {} },
  } as unknown);
  mocks.languageServerWithTransport.mockReturnValue(["lsp-extension-sentinel"]);
});

describe("CodeEditor LSP wiring", () => {
  it("never reaches for a language server for a non-JS/TS file", async () => {
    render(<CodeEditor {...baseProps} path="README.md" absPath="/repo/README.md" />);
    await screen.findByTestId("code-mirror");
    expect(mocks.getLspSession).not.toHaveBeenCalled();
    expect(mocks.languageServerWithTransport).not.toHaveBeenCalled();
  });

  it("requests a session for a TS file with the document URI and language id", async () => {
    render(<CodeEditor {...baseProps} />);
    await waitFor(() =>
      expect(mocks.getLspSession).toHaveBeenCalledWith(
        "/repo",
        "file:///repo/src/a.ts",
        "typescript",
      ),
    );
  });

  it("derives the language id from the extension, not the language pack", async () => {
    render(<CodeEditor {...baseProps} path="src/App.jsx" absPath="/repo/src/App.jsx" />);
    await waitFor(() =>
      expect(mocks.getLspSession).toHaveBeenCalledWith(
        "/repo",
        "file:///repo/src/App.jsx",
        "javascriptreact",
      ),
    );
  });

  it("adds no LSP extensions (and does not throw) when the server is unavailable", async () => {
    mocks.getLspSession.mockResolvedValue(null);
    render(<CodeEditor {...baseProps} />);
    await waitFor(() => expect(mocks.getLspSession).toHaveBeenCalled());
    expect(mocks.languageServerWithTransport).not.toHaveBeenCalled();
    expect(screen.getByTestId("code-mirror")).toHaveAttribute(
      "data-lsp-wired",
      "false",
    );
  });

  it("wires the LSP extensions into CodeMirror once a session resolves", async () => {
    const session = { client: { ready: true }, transport: { close: () => {} } };
    mocks.getLspSession.mockResolvedValue(session as unknown);

    render(<CodeEditor {...baseProps} />);

    await waitFor(() =>
      expect(screen.getByTestId("code-mirror")).toHaveAttribute(
        "data-lsp-wired",
        "true",
      ),
    );
    expect(mocks.languageServerWithTransport).toHaveBeenCalledTimes(1);
    expect(mocks.languageServerWithTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        client: session.client,
        transport: session.transport,
        documentUri: "file:///repo/src/a.ts",
        languageId: "typescript",
        rootUri: "file:///repo",
        allowHTMLContent: false,
      }),
    );
  });

  it("ignores a session that resolves after the editor moved to another file", async () => {
    // The first lookup is left deliberately unresolved so the path can change
    // underneath it, which is exactly the race the effect's `cancelled` flag
    // exists for: applying the stale result would point the LSP extensions at
    // a document the editor is no longer showing.
    let resolveFirst: (value: unknown) => void = () => {};
    const firstLookup = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const firstSession = { client: { ready: true }, transport: { close: () => {} } };
    const secondSession = { client: { ready: true }, transport: { close: () => {} } };

    mocks.getLspSession
      .mockReturnValueOnce(firstLookup as Promise<unknown>)
      .mockResolvedValueOnce(secondSession as unknown);

    const { rerender } = render(<CodeEditor {...baseProps} />);
    rerender(
      <CodeEditor {...baseProps} path="src/b.ts" absPath="/repo/src/b.ts" />,
    );

    await waitFor(() =>
      expect(mocks.languageServerWithTransport).toHaveBeenCalledTimes(1),
    );

    resolveFirst(firstSession);
    await firstLookup;

    expect(mocks.languageServerWithTransport).toHaveBeenCalledTimes(1);
    expect(mocks.languageServerWithTransport).toHaveBeenCalledWith(
      expect.objectContaining({ documentUri: "file:///repo/src/b.ts" }),
    );
  });
});
