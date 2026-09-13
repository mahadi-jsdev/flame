import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import {
  killPty,
  onPtyData,
  onPtyExit,
  resizePty,
  spawnPty,
  writePty,
} from "../lib/tauri";
import { useWorkspaceStore } from "../store/workspaceStore";
import "@xterm/xterm/css/xterm.css";

interface TerminalPaneProps {
  paneId: string;
}

const TERM_FONT =
  '"JetBrainsMono Nerd Font Mono", "JetBrainsMono NFM", "JetBrainsMono Nerd Font", "JetBrains Mono", "Fira Code", "Cascadia Code", "SF Mono", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

export function TerminalPane({ paneId }: TerminalPaneProps) {
  const divRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string>("");

  useEffect(() => {
    if (!divRef.current) return;

    let unlistenData: () => void = () => {};
    let unlistenExit: () => void = () => {};
    let unsubSettings: () => void = () => {};
    let resizeObserver: ResizeObserver | null = null;

    const initialSettings = useWorkspaceStore.getState().settings;
    const term = new Terminal({
      cursorBlink: initialSettings.cursorBlink,
      cursorStyle: initialSettings.cursorStyle,
      fontSize: initialSettings.fontSize,
      scrollback: initialSettings.scrollback,
      lineHeight: 1.25,
      fontFamily: TERM_FONT,
      fontWeight: 400,
      fontWeightBold: 700,
      letterSpacing: 0,
      minimumContrastRatio: 4.5,
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
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    const makeActive = () => {
      if (sessionIdRef.current) {
        useWorkspaceStore.getState().setActiveTerminal(sessionIdRef.current);
      }
    };

    const cleanup = async () => {
      resizeObserver?.disconnect();
      unlistenData();
      unlistenExit();
      unsubSettings();
      divRef.current?.removeEventListener("mousedown", makeActive);
      if (sessionIdRef.current) {
        await killPty(sessionIdRef.current);
      }
      term.dispose();
    };

    const start = async () => {
      try {
        await document.fonts.load('400 14px "JetBrainsMono Nerd Font Mono"');
        await document.fonts.load('700 14px "JetBrainsMono Nerd Font Mono"');

        term.open(divRef.current!);
        fitAddon.fit();

        const { cols, rows } = term;
        const cwd = useWorkspaceStore.getState().activeCwd();
        const { id, shell } = await spawnPty(undefined, rows, cols, cwd);
        sessionIdRef.current = id;
        useWorkspaceStore.getState().setSessionId(paneId, id, shell, cwd);
        useWorkspaceStore.getState().setActiveTerminal(id);

        const pane = useWorkspaceStore
          .getState()
          .workspaces.flatMap((w) => w.panes)
          .find((p) => p.id === paneId);
        if (pane?.startupCommand) {
          writePty(id, `${pane.startupCommand}\n`).catch(console.error);
          if (!pane.overlay) {
            useWorkspaceStore.getState().clearPaneStartupCommand(paneId);
          }
        }

        divRef.current?.addEventListener("mousedown", makeActive);

        term.onData((data) => {
          writePty(id, data).catch(console.error);
        });

        term.onResize(({ cols, rows }) => {
          resizePty(id, rows, cols).catch(console.error);
        });

        const unlistenDataPromise = onPtyData((payload) => {
          if (payload.id !== id) return;
          const bytes = new Uint8Array(
            atob(payload.chunk_b64)
              .split("")
              .map((c) => c.charCodeAt(0)),
          );
          term.write(bytes);
        });

        const unlistenExitPromise = onPtyExit((payload) => {
          if (payload.id !== id) return;
          term.writeln("\r\n[session ended]");
        });

        unlistenData = await unlistenDataPromise;
        unlistenExit = await unlistenExitPromise;

        unsubSettings = useWorkspaceStore.subscribe((s) => {
          const st = s.settings;
          const resized = term.options.fontSize !== st.fontSize;
          term.options.fontSize = st.fontSize;
          term.options.cursorStyle = st.cursorStyle;
          term.options.cursorBlink = st.cursorBlink;
          term.options.scrollback = st.scrollback;
          if (resized) {
            try {
              fitAddon.fit();
            } catch {
              // ignored
            }
          }
        });

        resizeObserver = new ResizeObserver(() => {
          try {
            fitAddon.fit();
          } catch {
            // ignored
          }
        });
        resizeObserver.observe(divRef.current!);
      } catch (e) {
        term.writeln(`\r\n[failed to spawn terminal: ${e}]`);
      }
    };

    start();

    return () => {
      cleanup();
    };
  }, [paneId]);

  return (
    <div ref={divRef} className="h-full w-full outline-none p-2" tabIndex={0} />
  );
}
