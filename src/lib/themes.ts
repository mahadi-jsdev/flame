import type { ITheme } from "@xterm/xterm";

export interface UiAccent {
  accent: string;
  accent2: string;
}

export interface TerminalTheme {
  label: string;
  theme: ITheme;
  ui: UiAccent;
}

export const THEMES: Record<string, TerminalTheme> = {
  aurora: {
    label: "Aurora",
    ui: { accent: "#22d3ee", accent2: "#8b5cf6" },
    theme: {
      background: "#080c14",
      foreground: "#d6e2f0",
      cursor: "#22d3ee",
      selectionBackground: "#1f4f7a",
      selectionForeground: "#ffffff",
      black: "#0f172a",
      red: "#f87171",
      green: "#34d399",
      yellow: "#facc15",
      blue: "#60a5fa",
      magenta: "#c084fc",
      cyan: "#22d3ee",
      white: "#f1f5f9",
      brightBlack: "#334155",
      brightRed: "#fca5a5",
      brightGreen: "#6ee7b7",
      brightYellow: "#fde047",
      brightBlue: "#93c5fd",
      brightMagenta: "#d8b4fe",
      brightCyan: "#67e8f9",
      brightWhite: "#ffffff",
    },
  },
  midnight: {
    label: "Midnight",
    ui: { accent: "#818cf8", accent2: "#38bdf8" },
    theme: {
      background: "#0a0e1a",
      foreground: "#c7d2e8",
      cursor: "#818cf8",
      selectionBackground: "#2e3a6f",
      selectionForeground: "#ffffff",
      black: "#111827",
      red: "#fb7185",
      green: "#4ade80",
      yellow: "#fbbf24",
      blue: "#818cf8",
      magenta: "#a78bfa",
      cyan: "#38bdf8",
      white: "#e5e7eb",
      brightBlack: "#374151",
      brightRed: "#fda4af",
      brightGreen: "#86efac",
      brightYellow: "#fcd34d",
      brightBlue: "#a5b4fc",
      brightMagenta: "#c4b5fd",
      brightCyan: "#7dd3fc",
      brightWhite: "#f9fafb",
    },
  },
  sunset: {
    label: "Sunset",
    ui: { accent: "#fb923c", accent2: "#f472b6" },
    theme: {
      background: "#160c0a",
      foreground: "#f3d9c9",
      cursor: "#fb923c",
      selectionBackground: "#7c3220",
      selectionForeground: "#ffffff",
      black: "#1c1210",
      red: "#f87171",
      green: "#a3e635",
      yellow: "#fbbf24",
      blue: "#fb7185",
      magenta: "#f472b6",
      cyan: "#fb923c",
      white: "#fde8d7",
      brightBlack: "#4b3a34",
      brightRed: "#fca5a5",
      brightGreen: "#bef264",
      brightYellow: "#fde68a",
      brightBlue: "#fda4af",
      brightMagenta: "#f9a8d4",
      brightCyan: "#fdba74",
      brightWhite: "#fff7ed",
    },
  },
  forest: {
    label: "Forest",
    ui: { accent: "#4ade80", accent2: "#2dd4bf" },
    theme: {
      background: "#0a120d",
      foreground: "#d3e8d9",
      cursor: "#4ade80",
      selectionBackground: "#1e4a30",
      selectionForeground: "#ffffff",
      black: "#0f1a13",
      red: "#f87171",
      green: "#4ade80",
      yellow: "#d9f99d",
      blue: "#5eead4",
      magenta: "#a3e635",
      cyan: "#2dd4bf",
      white: "#ecfdf3",
      brightBlack: "#2f4238",
      brightRed: "#fca5a5",
      brightGreen: "#86efac",
      brightYellow: "#e5f9a3",
      brightBlue: "#99f6e4",
      brightMagenta: "#bef264",
      brightCyan: "#5eead4",
      brightWhite: "#f0fdf4",
    },
  },
};

export const DEFAULT_THEME = "aurora";

export function resolveTheme(name: string): ITheme {
  return (THEMES[name] ?? THEMES[DEFAULT_THEME]).theme;
}

/** Applies a theme's accent colors to the document root as CSS variables,
 * driving every `accent`/`accent-2` Tailwind utility across the whole UI. */
export function applyUiTheme(name: string) {
  const { accent, accent2 } = (THEMES[name] ?? THEMES[DEFAULT_THEME]).ui;
  const root = document.documentElement.style;
  root.setProperty("--ui-accent", accent);
  root.setProperty("--ui-accent-2", accent2);
}
