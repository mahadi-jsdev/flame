# TypeScript/JavaScript LSP Integration — Design

## Context

Flame's in-app file editor ([FileEditorDialog.tsx](../../../src/components/FileEditorDialog.tsx) + [CodeEditor.tsx](../../../src/components/CodeEditor.tsx)) currently offers syntax highlighting only, via per-extension CodeMirror language packages in [codeLang.ts](../../../src/lib/codeLang.ts). There's no semantic awareness: no hover info, no inline diagnostics, no smart completion.

This adds Language Server Protocol support, scoped to TypeScript/JavaScript only (`.ts`/`.tsx`/`.js`/`.jsx`/`.mjs`/`.cjs`), backed by `typescript-language-server`. Other languages are out of scope for this pass; the design should not preclude adding them later, but no generic multi-language abstraction is being built now (YAGNI).

## Decisions

- **Server sourcing**: require `typescript-language-server` on `PATH`. No bundling, no `node_modules/.bin` lookup. If it's missing, the feature is simply unavailable for that project — no bundling/version-tracking burden.
- **Spawn timing**: lazy. One server process per project root, spawned the first time a JS/TS file is opened in the editor for that project. Never spawned for projects that don't open a JS/TS file in the editor.
- **Missing-binary / crash behavior**: fail silently. No dialog, no toast. The editor behaves exactly as it does today (plain highlighting only) for that project's session. No retry storm.
- **Transport**: Rust is a dumb pipe, mirroring the existing `PtyManager` pattern in [pty.rs](../../../src-tauri/src/pty.rs). All JSON-RPC/LSP protocol logic lives in the frontend.

## Architecture

A new Rust module `lsp.rs`, structurally a sibling of `pty.rs`. An `LspManager` spawns and owns one `typescript-language-server --stdio` child process per project root, keyed by the project's absolute root path. The frontend holds a matching `codemirror-languageserver`-backed client per open project, talking to its Rust-owned process over Tauri events/commands instead of a real stdio pipe or socket.

## Components

### `src-tauri/src/lsp.rs` (new)

`LspManager`, following `PtyManager`'s shape:
- `spawn(project_root: String) -> Result<LspSpawnResult, Error>` — spawns `typescript-language-server --stdio` with `cwd` set to `project_root`. Returns an error (mapped to a command error, not a panic) if the binary isn't found — the frontend treats this as "unavailable, don't retry."
- `send(id: &str, message: String)` — writes one JSON-RPC message (with `Content-Length` framing applied) to the child's stdin. Guarded by the same per-session `Mutex<Box<dyn Write>>` pattern already used for PTY writes ([pty.rs:140](../../../src-tauri/src/pty.rs:140)).
- `kill(id: &str)` — kills the child process for a project root (called on workspace/pane teardown, reusing whatever hook already tears down PTYs for a closed project — confirm the exact call site during implementation rather than inventing a new one).
- A background thread per spawned session reads stdout, incrementally parses the `Content-Length: N\r\n\r\n<N bytes>` framing (LSP's wire format — HTTP-style headers followed by a JSON body, not newline-delimited), and emits each fully-parsed JSON-RPC message as an `lsp-message` event `{ id, message }` — the same shape as `pty-data`/`pty-exit` in [pty.rs:93-132](../../../src-tauri/src/pty.rs:93). On stdout EOF or a read error, emits `lsp-exit` `{ id }`.

Registered in `lib.rs` alongside `PtyManager`, with three new `#[tauri::command]`s: `lsp_spawn`, `lsp_send`, `lsp_kill`.

### `src/lib/lspClient.ts` (new)

A thin transport adapter implementing the `Transport` interface `codemirror-languageserver` expects (a small `{ send, subscribe, onDispose }`-shaped contract — confirmed against the package's actual types during implementation), backed by `listen("lsp-message")` / `listen("lsp-exit")` and `invoke("lsp_send", ...)` instead of a raw socket or web worker.

Exposes a single entry point: `getLspClient(projectRoot: string): Promise<LanguageServerClient | null>` — returns `null` immediately (no spawn attempt) if a prior attempt for that root already failed or exited. Internally keyed by a `Map<projectRoot, ClientState>` where `ClientState` is `"pending" | { client } | "unavailable"`, so concurrent opens of multiple files in the same project share one spawn and one client rather than racing.

### `CodeEditor.tsx`

When `languageForPath(path)` resolves to a JS/TS language *and* `getLspClient(projectRoot)` resolves to a non-null client, adds the `codemirror-languageserver` extensions (hover tooltip source, lint/diagnostics source via `@codemirror/lint`, completion source via `@codemirror/autocomplete`) to the extension list alongside the existing `languageForPath`/`flameCodeTheme` extensions. `CodeEditor` needs `projectRoot` threaded in as a new prop (from `FileEditorDialog`'s existing `repoRoot`) so it can key the client lookup — file-level, not repo-level, since `didOpen`/`didClose` are per-document.

If no client is available (binary missing, wrong language, or the project hasn't resolved yet), `CodeEditor` renders exactly as it does today — this is strictly additive.

### Document sync

On mount, send `textDocument/didOpen` with the current buffer. On every `onChange`, debounce (~300ms) and send `textDocument/didChange` with the full updated text (full-document sync, not incremental — simplest correct option, revisit only if perf becomes a real issue on large files). On unmount, send `textDocument/didClose`. This is independent of Flame's own Save flow (`write_text_file`) — LSP sync tracks the in-editor buffer, not disk state.

## Data flow (file open → hover)

1. User opens `foo.ts` via the git panel or `Ctrl+P` → `FileEditorDialog` → `CodeEditor`.
2. `CodeEditor` resolves language = TypeScript, calls `getLspClient(repoRoot)`.
3. If this is the first JS/TS file opened for this project: `getLspClient` invokes `lsp_spawn`, then sends `initialize`/`initialized`, then `textDocument/didOpen` for `foo.ts`. If `lsp_spawn` errors, the project is marked `"unavailable"` and every subsequent call resolves `null` for the rest of the session.
4. User hovers a symbol → the CodeMirror hover extension calls the client → `textDocument/hover` request → `lsp_send` → child stdin → response arrives via the `lsp-message` event → matched back to the pending request by JSON-RPC id → tooltip renders.
5. Diagnostics arrive unprompted as `textDocument/publishDiagnostics` notifications over the same event path → mapped into a `@codemirror/lint` source → gutter marks + underlines, live-updated as the user types (via the debounced `didChange`).
6. If the server process dies mid-session, the `lsp-exit` event fires, `lspClient.ts` marks that project `"unavailable"`, and every open editor for that project silently drops back to plain CodeMirror (no reconnect attempt this pass).

## Error handling

- Spawn failure (binary not on `PATH`): silent, cached as `"unavailable"` per project root — matches the "fail silently" decision.
- Mid-session crash: silent fallback, same `"unavailable"` state, no auto-restart.
- Partial/split stdout reads: the `Content-Length` framing buffer accumulates bytes across multiple `read()` calls until a complete header + body is available before emitting — standard streaming-parser handling, not a new concept in this codebase but the one place that needs real care.
- A malformed message from the server (shouldn't happen with a spec-compliant server, but defensively): log and drop it rather than panicking the reader thread.

## Testing

- **Rust**: unit tests for the `Content-Length` framing/parsing function in isolation — feed it byte chunks split at arbitrary points (including mid-header and mid-body splits) and assert correct message boundaries and byte-exact bodies. This is the one genuinely fiddly piece of new Rust code and gets the most test weight.
- **Frontend — `lspClient.ts`**: tested against a fake `invoke`/`listen` pair, matching the existing mocking style used for `tauri.ts` elsewhere in the test suite. Cover: successful spawn + didOpen, spawn failure → subsequent calls short-circuit to `null` without re-invoking `lsp_spawn`, and `lsp-exit` → subsequent calls short-circuit to `null`.
- **Frontend — `CodeEditor.tsx`**: LSP wiring tested by mocking `codemirror-languageserver` and `lspClient.ts`, consistent with how `CodeEditor` itself is already mocked one level up in `FileEditorDialog.test.tsx`/`GitPanel.test.tsx` — avoids fighting jsdom with real LSP/CodeMirror extensions.
- **Manual verification** (browser preview + real app): open a `.ts` file with a deliberate type error and confirm the diagnostic underline/gutter mark; hover a known symbol and confirm the tooltip; type a partial identifier and confirm LSP-backed completions appear; confirm a project with no `typescript-language-server` on `PATH` shows zero difference from today's behavior.

## Out of scope (this pass)

- Any language other than TS/JS.
- Go-to-definition, find-references, rename, workspace symbol search.
- Auto-restart on crash.
- Bundling or auto-installing the server binary.
- Any UI affordance for "LSP unavailable" — it's silent by design.
