import { LanguageServerClient } from "codemirror-languageserver";
import type { Transport } from "codemirror-languageserver";
import { lspKill, lspSend, lspSpawn, onLspExit, onLspMessage } from "./tauri";

/** Converts an absolute filesystem path to a `file://` URI, as required by
 * `rootUri`/`documentUri`/`workspaceFolders` in the LSP spec. `encodeURI`
 * deliberately leaves `#` and `?` alone (they're legal URI delimiters), so
 * they have to be escaped by hand — otherwise a path like
 * `/repo/issue#42/a.ts` produces a URI whose "path" stops at the `#`, and
 * diagnostics/hover for that file never match the document it was opened
 * as. */
export function pathToFileUri(absPath: string): string {
  const normalized = absPath.replace(/\\/g, "/");
  const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const encoded = encodeURI(withLeadingSlash)
    .replace(/#/g, "%23")
    .replace(/\?/g, "%3F");
  return `file://${encoded}`;
}

/** Trailing slashes are cosmetic in a project root but not in a Map key —
 * `/repo` and `/repo/` would otherwise spawn (and cache) two separate
 * servers for the same project. Normalized once, at the `getLspSession`
 * boundary, rather than at each call site. */
function normalizeRoot(projectRoot: string): string {
  const stripped = projectRoot.replace(/\/+$/, "");
  return stripped === "" ? projectRoot : stripped;
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
  private unlistenMessage: () => void = () => {};
  private unlistenExit: () => void = () => {};

  private constructor(private root: string) {}

  /** Async factory rather than a constructor, so both `listen()` promises
   * have resolved before anyone can hold a transport. Registering them
   * from a constructor meant `close()` arriving before those promises
   * settled was a silent no-op that leaked both Tauri listeners for the
   * rest of the session. Mirrors TerminalPane's
   * `unlistenDataPromise`/`unlistenExitPromise` handling. */
  static async create(root: string): Promise<TauriLspTransport> {
    const transport = new TauriLspTransport(root);

    const unlistenMessagePromise = onLspMessage((payload) => {
      if (payload.root !== root) return;
      for (const handler of transport.messageHandlers) handler(payload.message);
    });
    const unlistenExitPromise = onLspExit((payload) => {
      if (payload.root !== root) return;
      for (const handler of transport.closeHandlers) handler();
    });

    transport.unlistenMessage = await unlistenMessagePromise;
    transport.unlistenExit = await unlistenExitPromise;
    return transport;
  }

  send(message: string) {
    lspSend(this.root, message).catch(console.error);
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
    this.unlistenMessage();
    this.unlistenExit();
    this.unlistenMessage = () => {};
    this.unlistenExit = () => {};
    lspKill(this.root).catch(console.error);
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
  const root = normalizeRoot(projectRoot);

  const existing = sessions.get(root);
  if (existing?.status === "ready") return existing.session;
  if (existing?.status === "unavailable") return null;
  if (existing?.status === "pending") return existing.promise;

  const promise = createSession(root, documentUri, languageId);
  sessions.set(root, { status: "pending", promise });
  const session = await promise;

  // Only publish the outcome if this call's own pending entry is still
  // the one in the cache. An `lsp-exit` that arrives while we're awaiting
  // already flipped the entry to "unavailable" and will not fire a second
  // time, so overwriting it with "ready" would cache a dead session
  // forever; releaseLspSession may likewise have dropped the entry.
  const current = sessions.get(root);
  if (current?.status === "pending" && current.promise === promise) {
    sessions.set(
      root,
      session ? { status: "ready", session } : { status: "unavailable" },
    );
  }
  return session;
}

/** Kills and evicts the cached LSP session for a project root, if one
 * exists — used when a project is removed from the workspace, so LSP
 * server processes don't accumulate across a long session. Safe to call
 * for a root with no session (no-op). */
export function releaseLspSession(projectRoot: string): void {
  const root = normalizeRoot(projectRoot);
  const existing = sessions.get(root);
  if (!existing) return;
  sessions.delete(root);
  if (existing.status === "ready") {
    existing.session.transport.close();
  } else if (existing.status === "pending") {
    existing.promise.then((session) => {
      session?.transport.close();
    }, console.error);
  }
}

async function createSession(
  projectRoot: string,
  documentUri: string,
  languageId: string,
): Promise<LspSession | null> {
  try {
    try {
      await lspSpawn(projectRoot);
    } catch {
      return null;
    }

    const transport = await TauriLspTransport.create(projectRoot);
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
    if (!client.ready) {
      transport.close();
      return null;
    }

    return { client, transport };
  } catch {
    // Nothing above is expected to throw synchronously, but a throw that
    // escaped here would leave the cache entry stuck at "pending" for the
    // rest of the session — every later call would await a rejected
    // promise instead of falling back to plain CodeMirror.
    return null;
  }
}
