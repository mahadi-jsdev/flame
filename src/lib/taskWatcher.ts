const AGENT_CMD =
  /\b(claude|codex|devin|gemini|aider|cursor-agent|opencode|copilot)\b/i;

export const BUSY_MIN_MS = 10_000;
export const QUIET_MS = 8_000;

export const AGENT_COLORS: Record<string, string> = {
  claude: "#22d3ee",
  codex: "#34d399",
  devin: "#f87171",
  gemini: "#60a5fa",
  aider: "#facc15",
  "cursor-agent": "#c084fc",
  opencode: "#fb923c",
  copilot: "#94a3b8",
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
 * available for the notification title/body.
 */
export class TaskWatcher {
  private busyMinMs: number;
  private quietMs: number;
  private onDone: (command: string) => void;
  private onCommand?: (command: string) => void;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastDataAt = 0;
  private busyStart = 0;
  private inputBuf = "";
  private lastCommand = "";

  constructor(opts: {
    onDone: (command: string) => void;
    onCommand?: (command: string) => void;
    busyMinMs?: number;
    quietMs?: number;
    intervalMs?: number;
  }) {
    this.onDone = opts.onDone;
    this.onCommand = opts.onCommand;
    this.busyMinMs = opts.busyMinMs ?? BUSY_MIN_MS;
    this.quietMs = opts.quietMs ?? QUIET_MS;
    this.intervalMs = opts.intervalMs ?? 2000;
  }
  private intervalMs: number;

  /** Call on every PTY output chunk. */
  onOutput() {
    const now = Date.now();
    this.lastDataAt = now;
    if (!this.busyStart) this.busyStart = now;
  }

  /** Call on every user keystroke (xterm onData). */
  onInput(data: string) {
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
    if (!this.busyStart || !this.lastDataAt) return;
    const quiet = Date.now() - this.lastDataAt;
    if (quiet < this.quietMs) return;
    const busyFor = this.lastDataAt - this.busyStart;
    this.busyStart = 0;
    if (busyFor >= this.busyMinMs) this.onDone(this.lastCommand);
  }
}
