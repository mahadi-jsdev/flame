# TypeScript/JavaScript LSP Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add hover, inline diagnostics, and completion to Flame's in-app file editor for TypeScript/JavaScript files, backed by `typescript-language-server`.

**Architecture:** A new Rust module (`lsp.rs`, a sibling of the existing `pty.rs`) spawns one `typescript-language-server --stdio` process per project root and acts as a dumb pipe: it frames/unframes the LSP wire protocol's `Content-Length` headers and relays raw JSON-RPC message strings to/from the frontend over Tauri events and commands, exactly like `PtyManager` already relays PTY bytes. All actual LSP protocol logic (request/response correlation, hover/diagnostics/completion wiring into CodeMirror) lives in the frontend via the `codemirror-languageserver` npm package, connected to Rust through a small custom `Transport` implementation.

**Tech Stack:** Rust (`std::process`, existing `tauri`/`serde` deps, no new crates), TypeScript/React, CodeMirror 6, `codemirror-languageserver@^1.22.1` (new dependency).

**Spec:** [docs/superpowers/specs/2026-09-16-ts-js-lsp-design.md](../specs/2026-09-16-ts-js-lsp-design.md)

## Global Constraints

- TS/JS only this pass: `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`. No other language servers.
- Require `typescript-language-server` on `PATH`. No bundling, no `node_modules/.bin` lookup.
- Missing binary or a mid-session server crash: fail silently. No dialog, no toast, no retry.
- Spawn lazily: one server process per project root, spawned the first time a JS/TS file is opened in the editor for that project.
- Rust is a dumb pipe. All JSON-RPC/LSP protocol logic lives in the frontend, using `codemirror-languageserver`.
- No auto-restart on crash, no auto-kill on last-pane-close this pass (see Task 2 note — this matches existing PTY lifecycle behavior in this codebase, which also has no project-level teardown hook).

**Deviation from the spec's "Document sync" section:** the spec described Flame manually sending debounced `textDocument/didOpen`/`didChange`/`didClose`. Inspecting `codemirror-languageserver@1.22.1`'s actual source (`LanguageServerPlugin` in `plugin.d.ts`/`plugin.js`) during planning showed it already does this internally — its CodeMirror `ViewPlugin` calls `initialize()` on attach (sending `didOpen`) and `sendChanges()` on every document update (sending `didChange`, full-document sync by default via `SynchronizationMethod.Full`) — triggered automatically by `languageServerWithTransport(...)`, the single call Task 6 uses to get hover/diagnostics/completion/etc. all at once. So this plan does not add any separate manual sync code; Task 6's `useEffect` only has to look up/create the shared `LspSession` and hand it to `languageServerWithTransport`.

---

## Task 1: Rust — LSP wire-protocol framing parser

**Files:**
- Create: `src-tauri/src/lsp.rs`

**Interfaces:**
- Produces: `fn extract_messages(buf: &mut Vec<u8>) -> Vec<String>` — pulls as many complete `Content-Length`-framed JSON-RPC message bodies as are available out of `buf`, in order, leaving any trailing partial message in `buf` for next time. Consumed by Task 2's reader thread.

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/lsp.rs` with just the test module (the file won't compile yet — `extract_messages` doesn't exist — which is the expected failing state for this step):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_a_single_complete_message() {
        let mut buf = b"Content-Length: 13\r\n\r\n{\"foo\":\"bar\"}".to_vec();
        let messages = extract_messages(&mut buf);
        assert_eq!(messages, vec!["{\"foo\":\"bar\"}".to_string()]);
        assert!(buf.is_empty());
    }

    #[test]
    fn leaves_a_partial_message_in_the_buffer() {
        let mut buf = b"Content-Length: 13\r\n\r\n{\"foo\":".to_vec();
        let messages = extract_messages(&mut buf);
        assert!(messages.is_empty());
        assert_eq!(buf, b"Content-Length: 13\r\n\r\n{\"foo\":".to_vec());
    }

    #[test]
    fn extracts_a_message_split_across_two_reads() {
        let mut buf = b"Content-Length: 13\r\n\r\n{\"foo\":".to_vec();
        assert!(extract_messages(&mut buf).is_empty());
        buf.extend_from_slice(b"\"bar\"}");
        let messages = extract_messages(&mut buf);
        assert_eq!(messages, vec!["{\"foo\":\"bar\"}".to_string()]);
        assert!(buf.is_empty());
    }

    #[test]
    fn extracts_multiple_messages_in_one_buffer() {
        let mut buf = b"Content-Length: 2\r\n\r\n{}Content-Length: 2\r\n\r\n[]".to_vec();
        let messages = extract_messages(&mut buf);
        assert_eq!(messages, vec!["{}".to_string(), "[]".to_string()]);
        assert!(buf.is_empty());
    }

    #[test]
    fn ignores_extra_headers_before_the_blank_line() {
        let mut buf =
            b"Content-Type: application/vscode-jsonrpc\r\nContent-Length: 2\r\n\r\n{}".to_vec();
        let messages = extract_messages(&mut buf);
        assert_eq!(messages, vec!["{}".to_string()]);
        assert!(buf.is_empty());
    }

    #[test]
    fn drops_a_header_with_no_content_length_rather_than_looping_forever() {
        let mut buf = b"Bogus-Header: nope\r\n\r\nContent-Length: 2\r\n\r\n{}".to_vec();
        let messages = extract_messages(&mut buf);
        assert_eq!(messages, vec!["{}".to_string()]);
        assert!(buf.is_empty());
    }
}
```

- [ ] **Step 2: Add the (empty) module and run to verify it fails**

Add `mod lsp;` to `src-tauri/src/lib.rs` (alongside the existing `mod pty;`) so the new file is compiled.

Run: `cd src-tauri && cargo test lsp::`
Expected: FAIL — `cannot find function \`extract_messages\` in this scope`.

- [ ] **Step 3: Implement `extract_messages`**

Add above the `#[cfg(test)]` block in `src-tauri/src/lsp.rs`:

```rust
/// Pulls complete `Content-Length`-framed JSON-RPC messages out of `buf`,
/// LSP's wire format (HTTP-style headers, blank line, then exactly
/// `Content-Length` body bytes — not newline-delimited JSON). Leaves any
/// trailing partial message in `buf` for the next read.
fn extract_messages(buf: &mut Vec<u8>) -> Vec<String> {
    let mut messages = Vec::new();
    loop {
        let header_end = match find_subslice(buf, b"\r\n\r\n") {
            Some(pos) => pos,
            None => break,
        };

        let content_length = std::str::from_utf8(&buf[..header_end])
            .ok()
            .and_then(|headers| {
                headers
                    .split("\r\n")
                    .find_map(|line| line.strip_prefix("Content-Length:"))
            })
            .and_then(|value| value.trim().parse::<usize>().ok());

        let content_length = match content_length {
            Some(n) => n,
            None => {
                // No usable Content-Length in this header block — drop it
                // and keep scanning, rather than looping on the same bytes.
                buf.drain(..header_end + 4);
                continue;
            }
        };

        let body_start = header_end + 4;
        let body_end = body_start + content_length;
        if buf.len() < body_end {
            break; // Body not fully received yet.
        }

        if let Ok(text) = String::from_utf8(buf[body_start..body_end].to_vec()) {
            messages.push(text);
        }
        buf.drain(..body_end);
    }
    messages
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test lsp::`
Expected: PASS — 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lsp.rs src-tauri/src/lib.rs
git commit -m "feat: add LSP wire-protocol framing parser"
```

---

## Task 2: Rust — `LspManager` process bridge and Tauri commands

**Files:**
- Modify: `src-tauri/src/lsp.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `extract_messages(&mut Vec<u8>) -> Vec<String>` from Task 1 (same file, private).
- Produces: `pub struct LspManager` with `pub fn new(app: AppHandle) -> Self`, `pub fn spawn(&self, root: String) -> Result<(), Box<dyn std::error::Error>>`, `pub fn send(&self, root: &str, message: &str) -> Result<(), Box<dyn std::error::Error>>`, `pub fn kill(&self, root: &str) -> Result<(), Box<dyn std::error::Error>>`. Three Tauri commands: `lsp_spawn(root: String)`, `lsp_send(root: String, message: String)`, `lsp_kill(root: String)`. Two emitted events: `lsp-message` (payload `{ root: String, message: String }`), `lsp-exit` (payload `{ root: String }`). Consumed by Task 3's frontend wrappers.

No automated test for this task — mirrors the existing `PtyManager` in `src-tauri/src/pty.rs`, which also spawns real child processes and has no unit tests (process-spawning integration behavior isn't unit-tested anywhere in this codebase; it's covered by manual verification in Task 7). `extract_messages` from Task 1 already carries the test weight for the one genuinely fiddly piece of logic.

**Lifecycle note:** No caller ever invokes `kill`/`lsp_kill` automatically in this pass. `removeProject` in `src/store/workspaceStore.ts` is a pure state reducer with no side effects (checked directly — it does not call `killPty` or any other cleanup), and there is no existing "last pane for this project closed" hook in the codebase to attach to. Rather than inventing new store-level side-effect plumbing, this plan leaves LSP processes running for the app's lifetime once spawned — the same risk profile PTY child processes already have (nothing explicitly kills them on project removal either). `kill`/`lsp_kill` are implemented and exposed for completeness and future use, just not wired to any automatic trigger yet.

- [ ] **Step 1: Add `LspManager` to `src-tauri/src/lsp.rs`**

Add above the `extract_messages` function (or anywhere above the `#[cfg(test)]` block):

```rust
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
pub struct LspMessagePayload {
    pub root: String,
    pub message: String,
}

#[derive(Clone, Serialize)]
pub struct LspExitPayload {
    pub root: String,
}

pub struct LspManager {
    sessions: Mutex<HashMap<String, LspSession>>,
    app: AppHandle,
}

struct LspSession {
    writer: Arc<Mutex<ChildStdin>>,
    child: Child,
}

impl LspManager {
    pub fn new(app: AppHandle) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            app,
        }
    }

    pub fn spawn(&self, root: String) -> Result<(), Box<dyn std::error::Error>> {
        let mut child = Command::new("typescript-language-server")
            .arg("--stdio")
            .current_dir(&root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?;

        let writer = child.stdin.take().ok_or("no stdin on lsp child")?;
        let mut reader = child.stdout.take().ok_or("no stdout on lsp child")?;

        let session = LspSession {
            writer: Arc::new(Mutex::new(writer)),
            child,
        };

        let root_for_reader = root.clone();
        self.sessions.lock().unwrap().insert(root, session);

        let app = self.app.clone();
        std::thread::spawn(move || {
            let mut pending: Vec<u8> = Vec::new();
            let mut chunk = [0u8; 4096];
            loop {
                match reader.read(&mut chunk) {
                    Ok(0) => {
                        let _ = app.emit(
                            "lsp-exit",
                            LspExitPayload {
                                root: root_for_reader,
                            },
                        );
                        break;
                    }
                    Ok(n) => {
                        pending.extend_from_slice(&chunk[..n]);
                        for message in extract_messages(&mut pending) {
                            let _ = app.emit(
                                "lsp-message",
                                LspMessagePayload {
                                    root: root_for_reader.clone(),
                                    message,
                                },
                            );
                        }
                    }
                    Err(_) => {
                        let _ = app.emit(
                            "lsp-exit",
                            LspExitPayload {
                                root: root_for_reader,
                            },
                        );
                        break;
                    }
                }
            }
        });

        Ok(())
    }

    pub fn send(&self, root: &str, message: &str) -> Result<(), Box<dyn std::error::Error>> {
        if let Some(session) = self.sessions.lock().unwrap().get(root) {
            let mut writer = session.writer.lock().unwrap();
            let framed = format!(
                "Content-Length: {}\r\n\r\n{}",
                message.as_bytes().len(),
                message
            );
            writer.write_all(framed.as_bytes())?;
            writer.flush()?;
        }
        Ok(())
    }

    pub fn kill(&self, root: &str) -> Result<(), Box<dyn std::error::Error>> {
        if let Some(mut session) = self.sessions.lock().unwrap().remove(root) {
            session.child.kill()?;
        }
        Ok(())
    }
}
```

- [ ] **Step 2: Register the module, manage `LspManager`, and add the three commands in `src-tauri/src/lib.rs`**

Change the top of `src-tauri/src/lib.rs`:

```rust
mod git;
mod pty;
mod lsp;
```

Add the import alongside the existing `use pty::{PtyManager, PtySpawnResult};` line:

```rust
use lsp::LspManager;
```

Add the three commands alongside the existing `spawn_pty`/`write_pty`/`resize_pty`/`kill_pty` commands:

```rust
#[tauri::command]
fn lsp_spawn(state: tauri::State<'_, LspManager>, root: String) -> Result<(), String> {
    state.spawn(root).map_err(|e| e.to_string())
}

#[tauri::command]
fn lsp_send(
    state: tauri::State<'_, LspManager>,
    root: String,
    message: String,
) -> Result<(), String> {
    state.send(&root, &message).map_err(|e| e.to_string())
}

#[tauri::command]
fn lsp_kill(state: tauri::State<'_, LspManager>, root: String) -> Result<(), String> {
    state.kill(&root).map_err(|e| e.to_string())
}
```

Find the existing `app.manage(PtyManager::new(app.handle().clone()));` line in the setup closure and add right after it:

```rust
            app.manage(LspManager::new(app.handle().clone()));
```

Find the `tauri::generate_handler![` list and add the three new commands (anywhere in the list, e.g. after `kill_pty,`):

```rust
            lsp_spawn,
            lsp_send,
            lsp_kill,
```

- [ ] **Step 3: Verify it builds cleanly**

Run: `cd src-tauri && cargo build`
Expected: builds with no errors.

Run: `cd src-tauri && cargo fmt -- --check`
Expected: no output (already formatted). If it reports diffs, run `cargo fmt` (no `--check`) and re-run the check.

Run: `cd src-tauri && cargo clippy --all-targets -- -D warnings`
Expected: no warnings (CI enforces this — see `.github/workflows/ci.yml`).

Run: `cd src-tauri && cargo test`
Expected: PASS — all existing tests plus Task 1's 6 new ones still pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lsp.rs src-tauri/src/lib.rs
git commit -m "feat: add LspManager process bridge and lsp_spawn/send/kill commands"
```

---

## Task 3: Frontend — Tauri LSP wrappers

**Files:**
- Modify: `src/lib/tauri.ts`

**Interfaces:**
- Consumes: `lsp_spawn`, `lsp_send`, `lsp_kill` commands and `lsp-message`/`lsp-exit` events from Task 2.
- Produces: `lspSpawn(root: string): Promise<void>`, `lspSend(root: string, message: string): Promise<void>`, `lspKill(root: string): Promise<void>`, `onLspMessage(cb: (payload: LspMessagePayload) => void): Promise<UnlistenFn>`, `onLspExit(cb: (payload: LspExitPayload) => void): Promise<UnlistenFn>`, and the exported types `LspMessagePayload { root: string; message: string }`, `LspExitPayload { root: string }`. Consumed by Task 5's `lspClient.ts`.

No dedicated test for this task — these are thin `invoke`/`listen` passthroughs with the same shape as the existing untested `spawnPty`/`writePty`/`onPtyData`/`onPtyExit` wrappers already in this file. They're exercised indirectly through Task 5's mocked tests.

- [ ] **Step 1: Add the payload types and wrapper functions**

Add near the existing `PtyDataPayload`/`PtyExitPayload` interfaces in `src/lib/tauri.ts`:

```typescript
export interface LspMessagePayload {
  root: string;
  message: string;
}

export interface LspExitPayload {
  root: string;
}
```

Add near the existing `spawnPty`/`writePty`/`resizePty`/`killPty`/`onPtyData`/`onPtyExit` functions:

```typescript
export function lspSpawn(root: string) {
  return invoke<void>("lsp_spawn", { root });
}

export function lspSend(root: string, message: string) {
  return invoke<void>("lsp_send", { root, message });
}

export function lspKill(root: string) {
  return invoke<void>("lsp_kill", { root });
}

export function onLspMessage(cb: (payload: LspMessagePayload) => void) {
  return listen<LspMessagePayload>("lsp-message", (e) => cb(e.payload));
}

export function onLspExit(cb: (payload: LspExitPayload) => void) {
  return listen<LspExitPayload>("lsp-exit", (e) => cb(e.payload));
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/tauri.ts
git commit -m "feat: add LSP invoke/listen wrappers to tauri.ts"
```

---

## Task 4: Frontend — LSP language-id detection

**Files:**
- Create: `src/lib/codeLang.test.ts`
- Modify: `src/lib/codeLang.ts`

**Interfaces:**
- Produces: `lspLanguageIdForPath(path: string): "typescript" | "typescriptreact" | "javascript" | "javascriptreact" | null`. Consumed by Task 6's `CodeEditor.tsx`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/codeLang.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { lspLanguageIdForPath } from "./codeLang";

describe("lspLanguageIdForPath", () => {
  it("maps .ts to typescript", () => {
    expect(lspLanguageIdForPath("src/a.ts")).toBe("typescript");
  });

  it("maps .tsx to typescriptreact", () => {
    expect(lspLanguageIdForPath("src/App.tsx")).toBe("typescriptreact");
  });

  it("maps .js, .mjs, and .cjs to javascript", () => {
    expect(lspLanguageIdForPath("a.js")).toBe("javascript");
    expect(lspLanguageIdForPath("a.mjs")).toBe("javascript");
    expect(lspLanguageIdForPath("a.cjs")).toBe("javascript");
  });

  it("maps .jsx to javascriptreact", () => {
    expect(lspLanguageIdForPath("App.jsx")).toBe("javascriptreact");
  });

  it("returns null for non-JS/TS extensions", () => {
    expect(lspLanguageIdForPath("README.md")).toBeNull();
    expect(lspLanguageIdForPath("styles.css")).toBeNull();
    expect(lspLanguageIdForPath("noextension")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- --run codeLang.test.ts`
Expected: FAIL — `lspLanguageIdForPath is not a function` (or a module resolution error, since it isn't exported yet).

- [ ] **Step 3: Implement `lspLanguageIdForPath`**

Add to `src/lib/codeLang.ts`, below `languageForPath`:

```typescript
/** LSP `languageId` for JS/TS files only — null means "not LSP-eligible",
 * same file-extension switch as languageForPath above. */
export function lspLanguageIdForPath(
  path: string,
): "typescript" | "typescriptreact" | "javascript" | "javascriptreact" | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "ts":
      return "typescript";
    case "tsx":
      return "typescriptreact";
    case "js":
    case "mjs":
    case "cjs":
      return "javascript";
    case "jsx":
      return "javascriptreact";
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- --run codeLang.test.ts`
Expected: PASS — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/codeLang.ts src/lib/codeLang.test.ts
git commit -m "feat: add lspLanguageIdForPath for JS/TS detection"
```

---

## Task 5: Frontend — LSP transport and shared client cache

**Files:**
- Modify: `package.json`
- Create: `src/lib/lspClient.ts`
- Create: `src/lib/lspClient.test.ts`

**Interfaces:**
- Consumes: `lspSpawn`, `lspSend`, `lspKill`, `onLspMessage`, `onLspExit` from Task 3's `src/lib/tauri.ts`; `LanguageServerClient` and the `Transport` type from `codemirror-languageserver`.
- Produces: `pathToFileUri(absPath: string): string`; `interface LspSession { client: LanguageServerClient; transport: Transport }`; `getLspSession(projectRoot: string, documentUri: string, languageId: string): Promise<LspSession | null>` — returns `null` immediately without re-spawning if a prior attempt for that `projectRoot` already failed or the server has exited. Consumed by Task 6's `CodeEditor.tsx`.

- [ ] **Step 1: Install the new dependency**

Run: `npm install codemirror-languageserver@^1.22.1`

Verify: `npm ls codemirror-languageserver` shows it resolved with no peer-dependency warnings (this codebase already has `@codemirror/autocomplete@6.20.3`, `@codemirror/lint@6.9.7`, `@codemirror/state@6.7.5`, and `@codemirror/view@6.43.12` installed transitively via `@uiw/react-codemirror`, which satisfy the package's peer ranges of `^6.18.6`/`^6.8.5`/`^6.5.2`/`^6.38.1` respectively).

- [ ] **Step 2: Write the failing tests**

Create `src/lib/lspClient.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeMessage {
  root: string;
  message: string;
}

const mocks = vi.hoisted(() => ({
  lspSpawn: vi.fn(async (_root: string) => {}),
  lspSend: vi.fn((_root: string, _message: string) => {}),
  lspKill: vi.fn((_root: string) => {}),
  messageHandlers: [] as Array<(payload: FakeMessage) => void>,
  exitHandlers: [] as Array<(payload: { root: string }) => void>,
}));

vi.mock("./tauri", () => ({
  lspSpawn: mocks.lspSpawn,
  lspSend: mocks.lspSend,
  lspKill: mocks.lspKill,
  onLspMessage: (cb: (payload: FakeMessage) => void) => {
    mocks.messageHandlers.push(cb);
    return Promise.resolve(() => {});
  },
  onLspExit: (cb: (payload: { root: string }) => void) => {
    mocks.exitHandlers.push(cb);
    return Promise.resolve(() => {});
  },
}));

import { getLspSession, pathToFileUri } from "./lspClient";

/** Simulates a language server that immediately answers `initialize`
 * requests sent through `lspSend`, so the real LanguageServerClient's
 * initialization handshake completes without a real process. */
function respondToInitializeRequests() {
  mocks.lspSend.mockImplementation((root: string, message: string) => {
    const parsed = JSON.parse(message);
    if (parsed.method === "initialize") {
      const response = JSON.stringify({
        jsonrpc: "2.0",
        id: parsed.id,
        result: { capabilities: {} },
      });
      for (const handler of mocks.messageHandlers) {
        handler({ root, message: response });
      }
    }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.messageHandlers.length = 0;
  mocks.exitHandlers.length = 0;
  respondToInitializeRequests();
});

describe("pathToFileUri", () => {
  it("converts an absolute path to a file:// URI", () => {
    expect(pathToFileUri("/home/user/project/a.ts")).toBe(
      "file:///home/user/project/a.ts",
    );
  });
});

describe("getLspSession", () => {
  it("spawns, initializes, and returns a ready session", async () => {
    const session = await getLspSession(
      "/proj/success",
      "file:///proj/success/a.ts",
      "typescript",
    );
    expect(session).not.toBeNull();
    expect(session?.client.ready).toBe(true);
    expect(mocks.lspSpawn).toHaveBeenCalledWith("/proj/success");
  });

  it("reuses the cached session on a second call instead of re-spawning", async () => {
    await getLspSession("/proj/reuse", "file:///proj/reuse/a.ts", "typescript");
    await getLspSession("/proj/reuse", "file:///proj/reuse/b.ts", "typescript");
    expect(mocks.lspSpawn).toHaveBeenCalledTimes(1);
  });

  it("returns null and caches unavailable when spawning fails", async () => {
    mocks.lspSpawn.mockRejectedValueOnce(new Error("binary not found"));
    const first = await getLspSession(
      "/proj/missing-binary",
      "file:///proj/missing-binary/a.ts",
      "typescript",
    );
    expect(first).toBeNull();

    const second = await getLspSession(
      "/proj/missing-binary",
      "file:///proj/missing-binary/b.ts",
      "typescript",
    );
    expect(second).toBeNull();
    expect(mocks.lspSpawn).toHaveBeenCalledTimes(1);
  });

  it("returns null for subsequent calls after the server exits", async () => {
    const first = await getLspSession(
      "/proj/crashes",
      "file:///proj/crashes/a.ts",
      "typescript",
    );
    expect(first).not.toBeNull();

    for (const handler of mocks.exitHandlers) {
      handler({ root: "/proj/crashes" });
    }

    const second = await getLspSession(
      "/proj/crashes",
      "file:///proj/crashes/b.ts",
      "typescript",
    );
    expect(second).toBeNull();
    expect(mocks.lspSpawn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm run test -- --run lspClient.test.ts`
Expected: FAIL — `./lspClient` module does not exist yet.

- [ ] **Step 4: Implement `src/lib/lspClient.ts`**

```typescript
import { LanguageServerClient } from "codemirror-languageserver";
import type { Transport } from "codemirror-languageserver";
import { lspKill, lspSend, lspSpawn, onLspExit, onLspMessage } from "./tauri";

/** Converts an absolute filesystem path to a `file://` URI, as required by
 * `rootUri`/`documentUri`/`workspaceFolders` in the LSP spec. */
export function pathToFileUri(absPath: string): string {
  const normalized = absPath.replace(/\\/g, "/");
  const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return `file://${encodeURI(withLeadingSlash)}`;
}

export interface LspSession {
  client: LanguageServerClient;
  transport: Transport;
}

/** Transport backed by Flame's Rust-owned child process instead of a raw
 * socket — see LspManager in src-tauri/src/lsp.rs. Filters the shared
 * lsp-message/lsp-exit event streams down to this session's own root,
 * the same pattern TerminalPane already uses for the shared pty-data
 * event stream. */
class TauriLspTransport implements Transport {
  private messageHandlers: Array<(message: string) => void> = [];
  private closeHandlers: Array<() => void> = [];
  private unlistenMessage: (() => void) | null = null;
  private unlistenExit: (() => void) | null = null;

  constructor(private root: string) {
    onLspMessage((payload) => {
      if (payload.root !== this.root) return;
      for (const handler of this.messageHandlers) handler(payload.message);
    }).then((unlisten) => {
      this.unlistenMessage = unlisten;
    });

    onLspExit((payload) => {
      if (payload.root !== this.root) return;
      for (const handler of this.closeHandlers) handler();
    }).then((unlisten) => {
      this.unlistenExit = unlisten;
    });
  }

  send(message: string) {
    void lspSend(this.root, message);
  }

  onMessage(callback: (message: string) => void) {
    this.messageHandlers.push(callback);
  }

  onClose(callback: () => void) {
    this.closeHandlers.push(callback);
  }

  onError(_callback: (error: Error) => void) {
    // The Rust bridge never emits a distinct error event: a failed spawn
    // rejects lspSpawn's promise (handled in createSession below), and a
    // dead process fires onClose instead.
  }

  close() {
    this.unlistenMessage?.();
    this.unlistenExit?.();
    void lspKill(this.root);
  }
}

type SessionState =
  | { status: "pending"; promise: Promise<LspSession | null> }
  | { status: "ready"; session: LspSession }
  | { status: "unavailable" };

const sessions = new Map<string, SessionState>();

/** One LspSession per project root, created lazily on first call and
 * reused after that. Returns null (without re-spawning) once a project
 * has been marked unavailable — either the binary wasn't found, or the
 * server has since exited. */
export async function getLspSession(
  projectRoot: string,
  documentUri: string,
  languageId: string,
): Promise<LspSession | null> {
  const existing = sessions.get(projectRoot);
  if (existing?.status === "ready") return existing.session;
  if (existing?.status === "unavailable") return null;
  if (existing?.status === "pending") return existing.promise;

  const promise = createSession(projectRoot, documentUri, languageId);
  sessions.set(projectRoot, { status: "pending", promise });
  const session = await promise;
  sessions.set(
    projectRoot,
    session ? { status: "ready", session } : { status: "unavailable" },
  );
  return session;
}

async function createSession(
  projectRoot: string,
  documentUri: string,
  languageId: string,
): Promise<LspSession | null> {
  try {
    await lspSpawn(projectRoot);
  } catch {
    return null;
  }

  const transport = new TauriLspTransport(projectRoot);
  const rootUri = pathToFileUri(projectRoot);
  const client = new LanguageServerClient({
    transport,
    rootUri,
    workspaceFolders: [
      { uri: rootUri, name: projectRoot.split("/").pop() ?? projectRoot },
    ],
    documentUri,
    languageId,
    autoClose: false,
  });

  transport.onClose(() => {
    sessions.set(projectRoot, { status: "unavailable" });
  });

  await client.initializePromise;
  if (!client.ready) return null;

  return { client, transport };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test -- --run lspClient.test.ts`
Expected: PASS — 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/lspClient.ts src/lib/lspClient.test.ts
git commit -m "feat: add LSP transport and shared session cache"
```

---

## Task 6: Frontend — wire LSP into `CodeEditor`

**Files:**
- Modify: `src/components/CodeEditor.tsx`
- Modify: `src/components/FileEditorDialog.tsx`

**Interfaces:**
- Consumes: `lspLanguageIdForPath` (Task 4), `getLspSession`/`pathToFileUri` (Task 5), `languageServerWithTransport` from `codemirror-languageserver`.
- Produces: `CodeEditor` gains two new required props, `absPath: string` and `projectRoot: string`, alongside its existing `value`/`onChange`/`path`/`autoFocus`.

No new test file for this task — `CodeEditor` is already treated as an integration point that's mocked wholesale one level up in `FileEditorDialog.test.tsx` and `GitPanel.test.tsx` (both mock `./CodeEditor` entirely, matching the CodeMirror/jsdom incompatibility noted when the editor was first built), so those existing tests are unaffected by this change and don't need edits. Correctness here is covered by Task 7's manual verification.

- [ ] **Step 1: Update `src/components/CodeEditor.tsx`**

Replace the full file contents:

```typescript
import CodeMirror from "@uiw/react-codemirror";
import { useEffect, useState } from "react";
import type { Extension } from "@codemirror/state";
import { languageServerWithTransport } from "codemirror-languageserver";
import { languageForPath, lspLanguageIdForPath } from "../lib/codeLang";
import { flameCodeTheme } from "../lib/codeTheme";
import { getLspSession, pathToFileUri } from "../lib/lspClient";

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  path: string;
  absPath: string;
  projectRoot: string;
  autoFocus?: boolean;
}

export function CodeEditor({
  value,
  onChange,
  path,
  absPath,
  projectRoot,
  autoFocus,
}: CodeEditorProps) {
  const [lspExtensions, setLspExtensions] = useState<Extension[]>([]);

  useEffect(() => {
    const languageId = lspLanguageIdForPath(path);
    if (!languageId) {
      setLspExtensions([]);
      return;
    }

    let cancelled = false;
    const documentUri = pathToFileUri(absPath);
    const rootUri = pathToFileUri(projectRoot);

    getLspSession(projectRoot, documentUri, languageId).then((session) => {
      if (cancelled || !session) return;
      setLspExtensions(
        languageServerWithTransport({
          client: session.client,
          transport: session.transport,
          documentUri,
          languageId,
          rootUri,
          workspaceFolders: [
            { uri: rootUri, name: projectRoot.split("/").pop() ?? projectRoot },
          ],
          allowHTMLContent: true,
        }),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [path, absPath, projectRoot]);

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={[...languageForPath(path), ...flameCodeTheme, ...lspExtensions]}
      theme="none"
      autoFocus={autoFocus}
      basicSetup={{ highlightActiveLine: true, foldGutter: true }}
      height="100%"
      style={{ height: "100%" }}
    />
  );
}
```

- [ ] **Step 2: Thread the new props through `src/components/FileEditorDialog.tsx`**

Find the existing render call (currently `<CodeEditor value={content} onChange={setContent} path={relPath} autoFocus />`) and replace it with:

```tsx
            <CodeEditor
              value={content}
              onChange={setContent}
              path={relPath}
              absPath={absPath}
              projectRoot={repoRoot}
              autoFocus
            />
```

(`absPath` and `repoRoot` are already props of `FileEditorDialog` itself, already in scope at this call site — no new prop threading needed above this component.)

- [ ] **Step 3: Verify nothing broke**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run test -- --run`
Expected: PASS — full suite (existing count plus Task 1/4/5 additions) passes unchanged, since `CodeEditor` stays mocked in every test that renders it.

- [ ] **Step 4: Commit**

```bash
git add src/components/CodeEditor.tsx src/components/FileEditorDialog.tsx
git commit -m "feat: wire LSP hover/diagnostics/completion into CodeEditor"
```

---

## Task 7: Manual end-to-end verification

Not covered by the automated suite — `invoke`/child-process spawning only works against the real Tauri backend, not the plain browser preview. Do this in the actual app (`npm run tauri dev`, or a rebuilt `.deb`/AppImage).

- [ ] **Step 1: Confirm the binary is available**

Run: `which typescript-language-server`

If missing, install it globally to test the "available" path: `npm install -g typescript-language-server typescript`.

- [ ] **Step 2: Verify hover**

Open a `.ts` file with a typed function via the git panel or `Ctrl+P`. Hover over a variable or function call. Expect a tooltip with type information within a second or two of the first open (the server needs a moment to initialize on a cold start).

- [ ] **Step 3: Verify diagnostics**

Introduce a deliberate type error (e.g. assign a `string` to a `number`-typed variable) in the open buffer without saving. Expect a red underline and a gutter mark to appear shortly after typing stops.

- [ ] **Step 4: Verify completion**

Start typing a partial identifier for something with a known API (e.g. `console.l`). Expect an LSP-backed completion list (not just the plain-text word-completion CodeMirror already does by default) offering `log`.

- [ ] **Step 5: Verify silent fallback**

Open a `.ts` file in a project, confirm the above works, then check that opening a non-JS/TS file (e.g. `.md`) shows no Diff/Edit-toggle-adjacent errors and behaves exactly as before this feature — plain highlighting only, no console errors. (The "binary genuinely missing" fallback path itself is already covered by Task 5's `lspClient.test.ts` "returns null and caches unavailable" test — no need to uninstall the binary manually to prove it.)

- [ ] **Step 6: Rebuild and hand off**

```bash
npm run tauri build -- --bundles deb,appimage
```

Refresh `~/.local/bin/Flame.AppImage` and report the `.deb` path, following the same pattern used for every previous build in this project.
