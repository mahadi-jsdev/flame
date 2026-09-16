import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeMessage {
  root: string;
  message: string;
}

const mocks = vi.hoisted(() => ({
  lspSpawn: vi.fn(async (_root: string) => {}),
  lspSend: vi.fn(async (_root: string, _message: string) => {}),
  lspKill: vi.fn(async (_root: string) => {}),
  messageHandlers: [] as Array<(payload: FakeMessage) => void>,
  exitHandlers: [] as Array<(payload: { root: string }) => void>,
  unlisten: vi.fn(() => {}),
}));

vi.mock("./tauri", () => ({
  lspSpawn: mocks.lspSpawn,
  lspSend: mocks.lspSend,
  lspKill: mocks.lspKill,
  onLspMessage: (cb: (payload: FakeMessage) => void) => {
    mocks.messageHandlers.push(cb);
    return Promise.resolve(mocks.unlisten);
  },
  onLspExit: (cb: (payload: { root: string }) => void) => {
    mocks.exitHandlers.push(cb);
    return Promise.resolve(mocks.unlisten);
  },
}));

import { getLspSession, pathToFileUri, releaseLspSession } from "./lspClient";

/** Simulates a language server that immediately answers `initialize`
 * requests sent through `lspSend`, so the real LanguageServerClient's
 * initialization handshake completes without a real process. */
function respondToInitializeRequests() {
  mocks.lspSend.mockImplementation(async (root: string, message: string) => {
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

  it("escapes # and ? so they stay part of the path, not URI delimiters", () => {
    expect(pathToFileUri("/repo/issue#42/a.ts")).toBe(
      "file:///repo/issue%2342/a.ts",
    );
    expect(pathToFileUri("/repo/what?/a.ts")).toBe("file:///repo/what%3F/a.ts");
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

  it("does not re-cache a session that was released while it was still initializing", async () => {
    // Removing a project mid-initialization deletes the pending entry and
    // closes the session as soon as it lands. Without the "is my pending
    // entry still the one in the cache?" guard, getLspSession's own tail
    // would then re-insert that just-killed session as "ready", and every
    // later open of that root would be handed a dead server.
    const pending = getLspSession(
      "/proj/released-mid-init",
      "file:///proj/released-mid-init/a.ts",
      "typescript",
    );
    releaseLspSession("/proj/released-mid-init");
    await pending;

    const second = await getLspSession(
      "/proj/released-mid-init",
      "file:///proj/released-mid-init/b.ts",
      "typescript",
    );
    expect(second).not.toBeNull();
    expect(mocks.lspSpawn).toHaveBeenCalledTimes(2);
  });

  it("treats a root with and without a trailing slash as one session", async () => {
    await getLspSession("/proj/slash", "file:///proj/slash/a.ts", "typescript");
    await getLspSession("/proj/slash/", "file:///proj/slash/b.ts", "typescript");
    expect(mocks.lspSpawn).toHaveBeenCalledTimes(1);
    expect(mocks.lspSpawn).toHaveBeenCalledWith("/proj/slash");
  });

  it("kills the process and caches unavailable when initialization never completes", async () => {
    // Override the default fake-server response: swallow every message
    // (including `initialize`) instead of answering it, so the real
    // LanguageServerClient's initialize request runs out its internal
    // timeout (timeout * 3 = 30s) without ever setting `client.ready`.
    mocks.lspSend.mockImplementation(async () => {});

    vi.useFakeTimers();
    try {
      const sessionPromise = getLspSession(
        "/proj/hangs",
        "file:///proj/hangs/a.ts",
        "typescript",
      );

      await vi.advanceTimersByTimeAsync(30_000);
      const session = await sessionPromise;

      expect(session).toBeNull();
      expect(mocks.lspKill).toHaveBeenCalledWith("/proj/hangs");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("releaseLspSession", () => {
  it("kills a ready session and unregisters its event listeners", async () => {
    const session = await getLspSession(
      "/proj/release",
      "file:///proj/release/a.ts",
      "typescript",
    );
    expect(session).not.toBeNull();
    expect(mocks.unlisten).not.toHaveBeenCalled();

    releaseLspSession("/proj/release");

    expect(mocks.lspKill).toHaveBeenCalledWith("/proj/release");
    // Both the lsp-message and the lsp-exit listener, not just one.
    expect(mocks.unlisten).toHaveBeenCalledTimes(2);
  });

  it("evicts the cache so the next open re-spawns instead of reusing a dead session", async () => {
    await getLspSession(
      "/proj/respawn",
      "file:///proj/respawn/a.ts",
      "typescript",
    );
    expect(mocks.lspSpawn).toHaveBeenCalledTimes(1);

    releaseLspSession("/proj/respawn");

    const second = await getLspSession(
      "/proj/respawn",
      "file:///proj/respawn/b.ts",
      "typescript",
    );
    expect(second).not.toBeNull();
    expect(mocks.lspSpawn).toHaveBeenCalledTimes(2);
  });

  it("is a no-op for a root that has no session", () => {
    expect(() => releaseLspSession("/proj/never-opened")).not.toThrow();
    expect(mocks.lspKill).not.toHaveBeenCalled();
  });
});
