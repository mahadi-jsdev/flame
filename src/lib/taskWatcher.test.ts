import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentColor, agentName, looksLikePrompt, shouldNotify, TaskWatcher } from "./taskWatcher";

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

describe("agentColor", () => {
  it("returns a color for a known agent", () => {
    expect(agentColor("claude -p 'fix bug'")).toBe("#ffb238");
  });

  it("returns null when no agent is detected", () => {
    expect(agentColor("ls -la")).toBeNull();
  });
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

  it("calls onCommand immediately when a line is entered", () => {
    const onDone = vi.fn();
    const onCommand = vi.fn();
    const w = new TaskWatcher({ onDone, onCommand, intervalMs: 1000 });
    w.start();
    w.onInput("claude -p 'go'\r");
    expect(onCommand).toHaveBeenCalledWith("claude -p 'go'");
    w.stop();
  });

  it("does not call onCommand for an empty line", () => {
    const onDone = vi.fn();
    const onCommand = vi.fn();
    const w = new TaskWatcher({ onDone, onCommand, intervalMs: 1000 });
    w.start();
    w.onInput("   \r");
    expect(onCommand).not.toHaveBeenCalled();
    w.stop();
  });

  it("isTypingLine is true mid-line and false once submitted", () => {
    const { w } = makeWatcher();
    expect(w.isTypingLine()).toBe(false);
    w.onInput("hello");
    expect(w.isTypingLine()).toBe(true);
    w.onInput("\r");
    expect(w.isTypingLine()).toBe(false);
    w.stop();
  });

  it("isTypingLine goes back to false after backspacing to empty", () => {
    const { w } = makeWatcher();
    w.onInput("a");
    expect(w.isTypingLine()).toBe(true);
    w.onInput("\x7f");
    expect(w.isTypingLine()).toBe(false);
    w.stop();
  });
});

describe("looksLikePrompt", () => {
  it.each([
    "Continue? (y/n)",
    "Overwrite file? [y/N]",
    "Proceed? [Y/n]",
    "Do you want to proceed?",
    "Do you want to make this edit to foo.ts?",
    "Do you want to create bar.ts?",
    "Do you trust the files in this folder?",
    "Allow this command to run?",
    "Press Enter to continue",
    "Apply changes (yes/no)?",
    // Claude Code's actual confirmation UI: a numbered menu, not y/n text.
    "  1. Yes\n     Proceed\n  2. No\nEnter to select · ↑/↓ to navigate · Esc to cancel",
    "Yes, and don't ask again",
  ])("recognizes: %s", (text) => {
    expect(looksLikePrompt(text)).toBe(true);
  });

  it.each([
    "Building project...",
    "5 files changed, 12 insertions(+)",
    "npm install completed successfully",
    "",
  ])("does not flag plain output: %s", (text) => {
    expect(looksLikePrompt(text)).toBe(false);
  });

  it("ignores ANSI escape codes when matching", () => {
    expect(looksLikePrompt("\x1b[33mContinue? (y/n)\x1b[0m")).toBe(true);
  });
});

describe("TaskWatcher waiting-for-input detection", () => {
  function makeWaitingWatcher() {
    const onDone = vi.fn();
    const onWaitingChange = vi.fn();
    const w = new TaskWatcher({
      onDone,
      onWaitingChange,
      intervalMs: 1000,
      waitingQuietMs: 1500,
    });
    w.start();
    return { w, onWaitingChange };
  }

  it("flags waiting once prompt-like output has been quiet long enough", () => {
    const { w, onWaitingChange } = makeWaitingWatcher();
    w.onOutput("Do you want to proceed? (y/n) ");
    vi.advanceTimersByTime(2000);
    expect(onWaitingChange).toHaveBeenCalledWith(true);
    w.stop();
  });

  it("does not flag waiting for ordinary output going quiet", () => {
    const { w, onWaitingChange } = makeWaitingWatcher();
    w.onOutput("Build succeeded in 2.3s");
    vi.advanceTimersByTime(5000);
    expect(onWaitingChange).not.toHaveBeenCalled();
    w.stop();
  });

  it("does not flag waiting before the quiet threshold has passed", () => {
    const { w, onWaitingChange } = makeWaitingWatcher();
    w.onOutput("Continue? (y/n) ");
    vi.advanceTimersByTime(1000);
    expect(onWaitingChange).not.toHaveBeenCalled();
    w.stop();
  });

  it("clears waiting as soon as the user responds", () => {
    const { w, onWaitingChange } = makeWaitingWatcher();
    w.onOutput("Continue? (y/n) ");
    vi.advanceTimersByTime(2000);
    expect(onWaitingChange).toHaveBeenLastCalledWith(true);
    w.onInput("y");
    expect(onWaitingChange).toHaveBeenLastCalledWith(false);
    w.stop();
  });

  it("clears waiting once new output resumes on its own", () => {
    const { w, onWaitingChange } = makeWaitingWatcher();
    w.onOutput("Continue? (y/n) ");
    vi.advanceTimersByTime(2000);
    expect(onWaitingChange).toHaveBeenLastCalledWith(true);
    w.onOutput("proceeding...");
    expect(onWaitingChange).toHaveBeenLastCalledWith(false);
    w.stop();
  });

  it("flags waiting for a Claude Code-style numbered confirmation menu, even padded with a heavy ANSI-styled frame", () => {
    const { w, onWaitingChange } = makeWaitingWatcher();
    // Simulates a real Ink-rendered picker: the question line arrives first,
    // then several KB of cursor-positioning/color escape codes and box
    // borders as the rest of the frame paints, delivered as separate PTY
    // chunks (as real reads would be) — well past the old 500-char tail cap.
    w.onOutput("\x1b[2K\x1b[1GJust testing — do you want to proceed?\r\n");
    const filler = "\x1b[38;5;240m│\x1b[0m padding to simulate a boxed TUI frame\r\n";
    for (let i = 0; i < 40; i++) w.onOutput(filler);
    w.onOutput(
      "\x1b[35m❯ 1. Yes\x1b[0m\r\n     Proceed\r\n  2. No\r\n     Don't proceed\r\n  3. Type something.\r\n\r\n  4. Chat about this\r\n\r\n",
    );
    w.onOutput("Enter to select · ↑/↓ to navigate · Esc to cancel");
    vi.advanceTimersByTime(2000);
    expect(onWaitingChange).toHaveBeenCalledWith(true);
    w.stop();
  });
});
