const AGENT_CMD =
  /\b(claude|codex|devin|gemini|aider|cursor-agent|opencode|copilot)\b/i;

export const BUSY_MIN_MS = 10_000;
export const QUIET_MS = 8_000;
export const WAITING_QUIET_MS = 1_500;

// Best-effort: common interactive-prompt phrasings used by AI coding agent
// CLIs and shells when they're blocked on a yes/no or permission answer.
// Necessarily a maintained list, not a general parser — false negatives
// (a prompt we don't recognize) just mean no "waiting" indicator, which is
// the same as today; false positives are the risk to keep in check.
const PROMPT_PATTERNS: RegExp[] = [
  /\(y\/n\)/i,
  /\[y\/n\]/i,
  /\[y\/N\]/,
  /\[Y\/n\]/,
  /\(yes\/no\)/i,
  /do you want to proceed/i,
  /do you want to make this edit/i,
  /do you want to create/i,
  /do you trust the files/i,
  /trust this (folder|workspace|directory)/i,
  /allow this (action|edit|command)/i,
  /overwrite\?\s*$/im,
  /continue\?\s*$/im,
  /press enter to continue/i,
  /\by\/n\b/i,
  // Claude Code (and similar Ink-based CLI menus) don't phrase their
  // confirmation dialogs as y/n at all — they render a numbered option list
  // with this footer, regardless of what the actual question says. This is
  // the reliable, question-agnostic signal for that whole class of prompt.
  /enter to (select|confirm)/i,
  /esc(ape)? to cancel/i,
  /\byes, and don't ask again\b/i,
];

// Strips common CSI/OSC ANSI escape sequences so prompt text can be matched
// against plain output rather than raw control codes.
const ANSI_ESCAPE_RE = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*(\x07|\x1b\\)/g;

export function looksLikePrompt(text: string): boolean {
  const clean = text.replace(ANSI_ESCAPE_RE, "");
  return PROMPT_PATTERNS.some((re) => re.test(clean));
}

export const AGENT_COLORS: Record<string, string> = {
  claude: "#ffb238",
  codex: "#8bb4e8",
  devin: "#ff6b52",
  gemini: "#7ec9c9",
  aider: "#ffcb6b",
  "cursor-agent": "#c9a877",
  opencode: "#e0894a",
  copilot: "#8c8172",
};

export function agentName(command: string): string | null {
  const m = command.match(AGENT_CMD);
  return m ? m[1].toLowerCase() : null;
}

export function agentColor(command: string): string | null {
  const name = agentName(command);
  return name ? AGENT_COLORS[name] ?? null : null;
}

export function shouldNotify(
  notificationsEnabled: boolean,
  windowFocused: boolean,
  isActivePane: boolean,
): boolean {
  if (!notificationsEnabled) return false;
  // if the user is looking at this very pane, no need to notify
  if (windowFocused && isActivePane) return false;
  return true;
}

/**
 * Watches a PTY stream: a burst of continuous output lasting `busyMinMs`
 * that then goes quiet for `quietMs` fires `onDone(lastCommand)`.
 * Input (user keystrokes) is tracked so the last typed command line is
 * available for the notification title/body, and so output can be told
 * apart from the shell simply echoing back what was just typed.
 * Also watches for the output tail going quiet right after something that
 * looks like a yes/no or permission prompt, firing `onWaitingChange(true)` —
 * cleared as soon as the user responds or new output resumes.
 */
export class TaskWatcher {
  private busyMinMs: number;
  private quietMs: number;
  private waitingQuietMs: number;
  private onDone: (command: string) => void;
  private onCommand?: (command: string) => void;
  private onWaitingChange?: (waiting: boolean) => void;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastDataAt = 0;
  private busyStart = 0;
  private inputBuf = "";
  private lastCommand = "";
  private outputTail = "";
  private waiting = false;

  constructor(opts: {
    onDone: (command: string) => void;
    onCommand?: (command: string) => void;
    onWaitingChange?: (waiting: boolean) => void;
    busyMinMs?: number;
    quietMs?: number;
    waitingQuietMs?: number;
    intervalMs?: number;
  }) {
    this.onDone = opts.onDone;
    this.onCommand = opts.onCommand;
    this.onWaitingChange = opts.onWaitingChange;
    this.busyMinMs = opts.busyMinMs ?? BUSY_MIN_MS;
    this.quietMs = opts.quietMs ?? QUIET_MS;
    this.waitingQuietMs = opts.waitingQuietMs ?? WAITING_QUIET_MS;
    this.intervalMs = opts.intervalMs ?? 2000;
  }
  private intervalMs: number;

  /** True while a line is being typed but not yet submitted (no trailing
   * Enter) — output arriving during this window is the shell's own echo of
   * the keystrokes, not the agent doing anything. */
  isTypingLine(): boolean {
    return this.inputBuf.length > 0;
  }

  /** Call on every PTY output chunk, with its decoded text. */
  onOutput(text = "") {
    const now = Date.now();
    this.lastDataAt = now;
    if (!this.busyStart) this.busyStart = now;
    // Generous window: a colorful, boxed TUI menu (cursor positioning +
    // color codes per line, box-drawing borders) can easily run to several
    // thousand raw bytes for what's visually a handful of lines — too small
    // a window here silently evicts the actual question text before it's
    // ever matched against.
    if (text) this.outputTail = (this.outputTail + text).slice(-4000);
    if (this.waiting) {
      this.waiting = false;
      this.onWaitingChange?.(false);
    }
  }

  /** Call on every user keystroke (xterm onData). */
  onInput(data: string) {
    if (data && this.waiting) {
      this.waiting = false;
      this.onWaitingChange?.(false);
    }
    for (const ch of data) {
      if (ch === "\r") {
        const cmd = this.inputBuf.trim();
        if (cmd) {
          this.lastCommand = cmd;
          this.onCommand?.(cmd);
        }
        this.inputBuf = "";
      } else if (ch === "\x7f") {
        this.inputBuf = this.inputBuf.slice(0, -1);
      } else if (ch === "\x03") {
        this.inputBuf = "";
      } else if (ch >= " ") {
        this.inputBuf += ch;
      }
    }
  }

  start() {
    this.stop();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick() {
    const now = Date.now();
    if (
      !this.waiting &&
      this.lastDataAt &&
      now - this.lastDataAt >= this.waitingQuietMs &&
      looksLikePrompt(this.outputTail)
    ) {
      this.waiting = true;
      this.onWaitingChange?.(true);
    }

    if (!this.busyStart || !this.lastDataAt) return;
    const quiet = now - this.lastDataAt;
    if (quiet < this.quietMs) return;
    const busyFor = this.lastDataAt - this.busyStart;
    this.busyStart = 0;
    if (busyFor >= this.busyMinMs) this.onDone(this.lastCommand);
  }
}
