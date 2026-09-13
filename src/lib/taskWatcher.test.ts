import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentName, shouldNotify, TaskWatcher } from "./taskWatcher";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function makeWatcher(busyMinMs = 10_000, quietMs = 8_000) {
  const onDone = vi.fn();
  const w = new TaskWatcher({ onDone, busyMinMs, quietMs, intervalMs: 1000 });
  w.start();
  return { w, onDone };
}

describe("agentName", () => {
  it.each([
    ["claude", "claude"],
    ["claude -p 'fix bug'", "claude"],
    ["npx codex", "codex"],
    ["codex --full-auto", "codex"],
    ["devin run", "devin"],
    ["CLAUDE_CODE=1 claude", "claude"],
    ["gemini", "gemini"],
    ["aider --model sonnet", "aider"],
    ["cursor-agent run", "cursor-agent"],
    ["opencode", "opencode"],
  ])("detects %s", (cmd, name) => {
    expect(agentName(cmd)).toBe(name);
  });

  it.each([["npm run build"], ["ls -la"], ["cargo test"], ["declaude"], [""]])(
    "no agent in %s",
    (cmd) => {
      expect(agentName(cmd)).toBeNull();
    },
  );
});

describe("shouldNotify", () => {
  it("off when notifications disabled", () => {
    expect(shouldNotify(false, false, false)).toBe(false);
  });
  it("off when watching the active pane in a focused window", () => {
    expect(shouldNotify(true, true, true)).toBe(false);
  });
  it("on when window unfocused", () => {
    expect(shouldNotify(true, false, true)).toBe(true);
  });
  it("on when pane is not the active one", () => {
    expect(shouldNotify(true, true, false)).toBe(true);
  });
});

describe("TaskWatcher", () => {
  it("fires after a long busy burst goes quiet", () => {
    const { w, onDone } = makeWatcher();
    // 15s of continuous output
    for (let i = 0; i < 15; i++) {
      w.onOutput();
      vi.advanceTimersByTime(1000);
    }
    expect(onDone).not.toHaveBeenCalled();
    // silence
    vi.advanceTimersByTime(9000);
    expect(onDone).toHaveBeenCalledTimes(1);
    w.stop();
  });

  it("does not fire for short output bursts", () => {
    const { w, onDone } = makeWatcher();
    for (let i = 0; i < 3; i++) {
      w.onOutput();
      vi.advanceTimersByTime(1000);
    }
    vi.advanceTimersByTime(20_000);
    expect(onDone).not.toHaveBeenCalled();
    w.stop();
  });

  it("does not fire while output is still flowing", () => {
    const { w, onDone } = makeWatcher();
    for (let i = 0; i < 30; i++) {
      w.onOutput();
      vi.advanceTimersByTime(1000);
    }
    // still streaming — no notification even though long-running
    expect(onDone).not.toHaveBeenCalled();
    w.stop();
  });

  it("brief pauses inside a busy window do not fire", () => {
    const { w, onDone } = makeWatcher();
    // 6s output, 3s pause, 6s output — pause < QUIET_MS keeps window alive
    for (let i = 0; i < 6; i++) {
      w.onOutput();
      vi.advanceTimersByTime(1000);
    }
    vi.advanceTimersByTime(3000);
    for (let i = 0; i < 6; i++) {
      w.onOutput();
      vi.advanceTimersByTime(1000);
    }
    expect(onDone).not.toHaveBeenCalled();
    vi.advanceTimersByTime(9000);
    expect(onDone).toHaveBeenCalledTimes(1);
    w.stop();
  });

  it("fires again on a second independent busy window", () => {
    const { w, onDone } = makeWatcher();
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < 12; i++) {
        w.onOutput();
        vi.advanceTimersByTime(1000);
      }
      vi.advanceTimersByTime(9000);
    }
    expect(onDone).toHaveBeenCalledTimes(2);
    w.stop();
  });

  it("passes the last typed command to onDone", () => {
    const { w, onDone } = makeWatcher();
    w.onInput("claude -p 'fix tests'\r");
    for (let i = 0; i < 12; i++) {
      w.onOutput();
      vi.advanceTimersByTime(1000);
    }
    vi.advanceTimersByTime(9000);
    expect(onDone).toHaveBeenCalledWith("claude -p 'fix tests'");
    w.stop();
  });

  it("tracks command line editing (backspace, ctrl-c)", () => {
    const { w, onDone } = makeWatcher();
    w.onInput("claudeX\x7f"); // "claudeX" -> backspace -> "claude"
    w.onInput("\r");
    for (let i = 0; i < 12; i++) {
      w.onOutput();
      vi.advanceTimersByTime(1000);
    }
    vi.advanceTimersByTime(9000);
    expect(onDone).toHaveBeenCalledWith("claude");
    w.stop();
  });

  it("ctrl-c clears the input buffer", () => {
    const { w, onDone } = makeWatcher();
    w.onInput("some-long-cmd\x03"); // cancelled
    w.onInput("codex\r");
    for (let i = 0; i < 12; i++) {
      w.onOutput();
      vi.advanceTimersByTime(1000);
    }
    vi.advanceTimersByTime(9000);
    expect(onDone).toHaveBeenCalledWith("codex");
    w.stop();
  });

  it("no output means no notification ever", () => {
    const { onDone } = makeWatcher();
    vi.advanceTimersByTime(60_000);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("empty/whitespace command is not remembered", () => {
    const { w, onDone } = makeWatcher();
    w.onInput("   \r");
    w.onInput("real-cmd\r");
    for (let i = 0; i < 12; i++) {
      w.onOutput();
      vi.advanceTimersByTime(1000);
    }
    vi.advanceTimersByTime(9000);
    expect(onDone).toHaveBeenCalledWith("real-cmd");
    w.stop();
  });
});
