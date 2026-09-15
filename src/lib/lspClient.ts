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
  if (!client.ready) {
    transport.close();
    return null;
  }

  return { client, transport };
}
