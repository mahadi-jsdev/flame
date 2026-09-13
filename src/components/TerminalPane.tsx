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
import "@xterm/xterm/css/xterm.css";

export function TerminalPane() {
  const divRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!divRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      theme: { background: "#020617", foreground: "#e2e8f0" },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(divRef.current);
    fitAddon.fit();

    const { cols, rows } = term;
    const sessionIdRef = { current: "" };

    let unlistenData: () => void = () => {};
    let unlistenExit: () => void = () => {};

    const cleanup = async () => {
      unlistenData();
      unlistenExit();
      if (sessionIdRef.current) {
        await killPty(sessionIdRef.current);
      }
    };

    const start = async () => {
      try {
        const id = await spawnPty(undefined, rows, cols);
        sessionIdRef.current = id;

        term.onData((data) => {
          writePty(id, data).catch(console.error);
        });

        term.onResize(({ cols, rows }) => {
          resizePty(id, rows, cols).catch(console.error);
        });

        const unlistenDataPromise = onPtyData((payload) => {
          if (payload.id !== id) return;
          const bytes = new Uint8Array(
            atob(payload.chunk_b64).split("").map((c) => c.charCodeAt(0))
          );
          term.write(bytes);
        });

        const unlistenExitPromise = onPtyExit((payload) => {
          if (payload.id !== id) return;
          term.writeln("\r\n[session ended]");
        });

        unlistenData = await unlistenDataPromise;
        unlistenExit = await unlistenExitPromise;
      } catch (e) {
        term.writeln(`\r\n[failed to spawn terminal: ${e}]`);
      }
    };

    start();

    const handleResize = () => {
      try {
        fitAddon.fit();
      } catch {
        // ignored
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      cleanup();
      term.dispose();
    };
  }, []);

  return <div ref={divRef} className="h-full w-full" />;
}
