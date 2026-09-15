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
