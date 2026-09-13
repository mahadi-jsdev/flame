# AI Terminal Agent — Project Guide

## What this is

AI Terminal Agent is a BridgeMind-inspired desktop workspace for local AI agents.
It is a cross-platform Tauri 2 application (macOS, Linux, Windows) that gives the
user a multi-pane terminal workspace for running local CLI agents such as
Claude Code, Codex, Cursor, or any custom shell script that is already on their
`PATH` and billed through their own accounts.

MVP scope (what is currently built):

- Multiple workspaces.
- Each workspace can contain multiple project folders.
- Active project sets the working directory for newly spawned terminals.
- Sidebar workspace switcher, project switcher, active-project file tree, and a Files/Git toggle for git status/actions.
- Resizable multi-pane terminal grid per workspace.
- Real PTY sessions via `portable-pty` on the Rust side and `xterm.js` in the
  React frontend.
- A single "New Terminal" action (plus `Ctrl/Cmd + Shift + T`).
- Dark, glassmorphic UI with cyan/violet accents.

Out of scope for the MVP:

- Cloud AI providers, API keys, billing, or persistence.
- Chat, browser preview, voice, plugins, agent routines, SSH/fleet.
- A full code editor.

## Technology stack

- **Shell / backend:** Tauri 2, Rust 2021, `portable-pty` 0.9.
- **Frontend:** React 19, TypeScript, Vite 8, Tailwind CSS 4.
- **State:** Zustand 5.
- **Terminal rendering:** `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`.
- **Layout:** `react-resizable-panels` 4.x (`Group`, `Panel`, `Separator`).
- **Icons:** `lucide-react`.

## Project layout

```text
src/                         React / TypeScript frontend
  App.tsx
  main.tsx
  index.css                  Tailwind v4 import, fonts, scrollbars, animations
  components/
    Workspace.tsx            Main shell, toolbar, terminal grid, footer
    Sidebar.tsx              Workspace switcher
    ProjectPanel.tsx         Project switcher + Files/Git tab
    TerminalPane.tsx         xterm.js pane wired to PTY
  lib/
    tauri.ts                 Tauri command helpers
  store/
    workspaceStore.ts        Zustand state for workspaces/projects/panes
src-tauri/                   Rust / Tauri backend
  Cargo.toml
  tauri.conf.json
  src/
    lib.rs                   Tauri command registration
    pty.rs                   PTY manager with portable-pty
    filesystem.rs            Directory listing
    git.rs                   Git status and branch helpers
AGENTS.md                    This file
```

## Common development commands

Install dependencies:

```bash
npm install
```

Run the Tauri dev app (recommended):

```bash
npm run tauri dev
```

Type-check the frontend:

```bash
npx tsc --noEmit
```

Run Rust tests:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Build release bundles (Linux `.deb`, `.rpm`, `.AppImage`):

```bash
npm run tauri build
```

## Conventions to know

- **Tailwind v4** is used with `@import "tailwindcss"` in `src/index.css`.
- The workspace is **terminal-only**. Chat and browser panes have been removed
  from the design.
- Terminals are arranged in a **CSS grid** (1×1, 1×2, 2×2, up to 3 columns).
- Each terminal pane shows its number and shell name; the focused terminal gets
  an "Active" badge and the footer shows the active terminal number.
- PTY sessions are ephemeral: closing a pane or the app kills the session.
- New terminals spawn in the active project’s directory.
- No cloud services, API keys, billing, or workspace persistence are present in
  the MVP.

## Design tokens

- Background: `#05070a`
- Terminal background: `#080c14`
- Primary accent: `cyan-400` (`#22d3ee`)
- Secondary accent: `violet-500` / `violet-600`
- Border: `white/10`
- Header / sidebar: `bg-slate-950/60` with `backdrop-blur-xl`
- Card surfaces: `bg-slate-900/60` with `backdrop-blur-sm`

## Useful notes

- On Linux, Tauri needs `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`,
  `librsvg2-dev`, `libssl-dev`, `libxdo-dev`, `build-essential`, and `pkg-config`.
- The default PTY shell is read from `$SHELL` and falls back to `bash`.
- Release bundles are written to `src-tauri/target/release/bundle/`.
