import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import {
  killPty,
  onPtyData,
  onPtyExit,
  resizePty,
  spawnPty,
  writePty,
} from "../lib/tauri";
import { useWorkspaceStore } from "../store/workspaceStore";
import { agentColor, agentName, shouldNotify, TaskWatcher } from "../lib/taskWatcher";
import { resolveTheme } from "../lib/themes";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import "@xterm/xterm/css/xterm.css";

interface TerminalPaneProps {
  paneId: string;
  visible: boolean;
}

const TERM_FONT =
  '"JetBrainsMono Nerd Font Mono", "JetBrainsMono NFM", "JetBrainsMono Nerd Font", "JetBrains Mono", "Fira Code", "Cascadia Code", "SF Mono", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

export function TerminalPane({ paneId, visible }: TerminalPaneProps) {
  const divRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string>("");
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const reattachWebglRef = useRef<(() => void) | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // The pane's container is toggled display:none <-> block when switching
  // projects/workspaces (see Workspace.tsx's "always mounted" pattern) rather
  // than ever unmounting, leaving xterm fit to a stale (often much narrower)
  // size from whenever it was last visible until something re-fits it. A
  // plain useEffect fires AFTER the browser has already painted — so the
  // browser paints one frame of the newly-revealed pane at its stale size
  // before the fit correction ever runs. useLayoutEffect runs synchronously
  // after the DOM update but before paint, so measuring/fitting here lands
  // in the same frame the pane becomes visible.
  //
  // fit() alone wasn't enough for the WebGL-rendered path specifically: the
  // GPU canvas's backing pixel buffer can end up stuck at whatever size it
  // was when the pane went display:none, so for one frame the (correctly
  // resized) CSS box stretches that stale, lower-res buffer across itself —
  // huge, blurry glyphs — until the addon's own resize logic catches up.
  // Disposing and recreating the WebGL addon after fit() forces it to
  // allocate a fresh, correctly-sized canvas immediately instead of racing
  // its internal resize handling.
  useLayoutEffect(() => {
    if (!visible) return;
    try {
      fitAddonRef.current?.fit();
    } catch {
      // layout not ready yet — the rAF follow-up below will catch it
    }
    reattachWebglRef.current?.();
    const raf = requestAnimationFrame(() => {
      try {
        fitAddonRef.current?.fit();
      } catch {
        // pane may have unmounted between frames
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    if (!divRef.current) return;

    let unlistenData: () => void = () => {};
    let unlistenExit: () => void = () => {};
    let unsubSettings: () => void = () => {};
    let unsubActive: () => void = () => {};
    let resizeObserver: ResizeObserver | null = null;
    let autoTagged = false;
    let runningTimeout: ReturnType<typeof setTimeout> | null = null;
    // React 18 StrictMode double-invokes this effect (mount -> cleanup ->
    // mount) in dev. `start()` is async and awaits before touching the DOM
    // or spawning a PTY, so without this guard both invocations resume
    // after their awaits and each call term.open()/spawnPty() on the same
    // div, leaving two live xterm instances stacked in one container and a
    // leaked orphaned PTY process.
    let cancelled = false;

    const markRunning = () => {
      useWorkspaceStore.getState().setPaneRunning(paneId, true);
      if (runningTimeout) clearTimeout(runningTimeout);
      runningTimeout = setTimeout(() => {
        useWorkspaceStore.getState().setPaneRunning(paneId, false);
      }, 1200);
    };
    const watcher = new TaskWatcher({
      onDone: (command) => void maybeNotify(command),
      onCommand: (command) => maybeAutoTag(command),
      onWaitingChange: (waiting) => {
        useWorkspaceStore.getState().setPaneWaiting(paneId, waiting);
        if (waiting) void notifyWaiting();
      },
    });

    const maybeAutoTag = (command: string) => {
      if (autoTagged) return;
      const pane = useWorkspaceStore
        .getState()
        .workspaces.flatMap((w) => w.panes)
        .find((p) => p.id === paneId);
      if (pane?.title || pane?.color) return;
      const agent = agentName(command);
      if (!agent) return;
      autoTagged = true;
      useWorkspaceStore.getState().renamePane(paneId, agent);
      const color = agentColor(command);
      if (color) useWorkspaceStore.getState().setPaneColor(paneId, color);
    };

    const sendNotification = async (title: string, body: string) => {
      const st = useWorkspaceStore.getState();
      const w = st.getActiveWorkspace();
      const isActivePane = w?.activeTerminalId === sessionIdRef.current;
      if (
        !shouldNotify(
          st.settings.notifications,
          document.hasFocus(),
          isActivePane,
        )
      )
        return;
      try {
        const mod = await import("@tauri-apps/plugin-notification");
        if (!(await mod.isPermissionGranted())) {
          if ((await mod.requestPermission()) !== "granted") return;
        }
        await mod.sendNotification({ title, body });
      } catch {
        // notifications unavailable
      }
    };

    const maybeNotify = (command: string) => {
      const agent = agentName(command);
      return sendNotification(
        agent ? `${agent} finished` : "Terminal task finished",
        command || "A task completed or is waiting for input",
      );
    };

    const notifyWaiting = () => {
      const pane = useWorkspaceStore
        .getState()
        .workspaces.flatMap((w) => w.panes)
        .find((p) => p.id === paneId);
      const label = pane?.title ?? "Terminal";
      return sendNotification(`${label} needs your input`, "Waiting on a prompt or confirmation");
    };

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
      theme: resolveTheme(initialSettings.theme),
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    fitAddonRef.current = fitAddon;
    const searchAddon = new SearchAddon();
    term.loadAddon(searchAddon);
    searchAddonRef.current = searchAddon;

    term.loadAddon(
      new WebLinksAddon((_event, uri) => {
        import("@tauri-apps/plugin-opener")
          .then((mod) => mod.openUrl(uri))
          .catch(() => window.open(uri, "_blank", "noopener,noreferrer"));
      }),
    );

    // @xterm/xterm ships no accelerated renderer of its own — without this,
    // every glyph is a plain styled DOM <span>, which renders noticeably
    // blurrier/softer than a GPU-rendered glyph atlas. Falls back to that
    // same DOM rendering (silently) if WebGL is unavailable, the context is
    // lost, or attaching throws. Recreated (not just resized) whenever the
    // pane becomes visible again — see the useLayoutEffect above.
    let webglAddon: WebglAddon | null = null;
    const attachWebgl = () => {
      webglAddon?.dispose();
      webglAddon = null;
      try {
        const addon = new WebglAddon();
        addon.onContextLoss(() => {
          addon.dispose();
          if (webglAddon === addon) webglAddon = null;
        });
        term.loadAddon(addon);
        webglAddon = addon;
      } catch {
        // no WebGL support — DOM renderer remains active
      }
    };
    reattachWebglRef.current = attachWebgl;

    const makeActive = () => {
      if (sessionIdRef.current) {
        useWorkspaceStore.getState().setActiveTerminal(sessionIdRef.current);
      }
    };

    const cleanup = async () => {
      resizeObserver?.disconnect();
      watcher.stop();
      if (runningTimeout) clearTimeout(runningTimeout);
      unlistenData();
      unlistenExit();
      unsubSettings();
      unsubActive();
      divRef.current?.removeEventListener("mousedown", makeActive);
      if (sessionIdRef.current) {
        await killPty(sessionIdRef.current);
      }
      searchAddonRef.current = null;
      fitAddonRef.current = null;
      reattachWebglRef.current = null;
      webglAddon?.dispose();
      term.dispose();
    };

    const start = async () => {
      try {
        await document.fonts.load('400 14px "JetBrainsMono Nerd Font Mono"');
        await document.fonts.load('700 14px "JetBrainsMono Nerd Font Mono"');
        try {
          await document.fonts.ready;
        } catch {
          // ignored — proceed with whatever metrics are available
        }
        if (cancelled) return;

        term.open(divRef.current!);
        fitAddon.fit();
        attachWebgl();

        // Re-fit once more after layout fully settles. A still-resolving
        // flex/grid layout (or a font whose real metrics differ slightly
        // from what was available at the first fit) can otherwise leave
        // xterm with more rows than the box actually has room for, which
        // then bleeds past the card since nothing clips it mid-render.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            try {
              fitAddon.fit();
            } catch {
              // pane may have unmounted between frames
            }
          });
        });

        term.attachCustomKeyEventHandler((e) => {
          if (e.type !== "keydown") return true;
          const ctrlOrCmd = e.ctrlKey || e.metaKey;
          if (ctrlOrCmd && e.key.toLowerCase() === "f") {
            setSearchOpen(true);
            return false;
          }
          // Ctrl+P is the global "go to file" shortcut (Workspace.tsx) —
          // block xterm from forwarding it to the shell as a raw control
          // byte (readline treats that as "previous history") so the
          // keydown still bubbles up to the window-level handler instead.
          if (ctrlOrCmd && !e.shiftKey && e.key.toLowerCase() === "p") {
            return false;
          }
          // Plain Ctrl+C/Ctrl+V stay reserved for SIGINT and literal paste —
          // Ctrl+Shift+C/V is the conventional Linux-terminal copy/paste.
          if (ctrlOrCmd && e.shiftKey && e.key.toLowerCase() === "c") {
            const selection = term.getSelection();
            if (selection) {
              navigator.clipboard?.writeText(selection).catch(() => {});
              return false;
            }
            return true;
          }
          if (ctrlOrCmd && e.shiftKey && e.key.toLowerCase() === "v") {
            navigator.clipboard
              ?.readText()
              .then((text) => {
                if (text && sessionIdRef.current) {
                  writePty(sessionIdRef.current, text).catch(console.error);
                  // This bypasses term.onData, so feed the watcher directly —
                  // otherwise a pasted agent-launch command (e.g. "claude")
                  // never reaches maybeAutoTag and that pane never appears
                  // in the sidebar's Agents list despite actually running.
                  watcher.onInput(text);
                }
              })
              .catch(() => {});
            return false;
          }
          return true;
        });

        const { cols, rows } = term;
        const owningWorkspace = useWorkspaceStore
          .getState()
          .workspaces.find((w) => w.panes.some((p) => p.id === paneId));
        const pane = owningWorkspace?.panes.find((p) => p.id === paneId);
        const paneProjectRoot = owningWorkspace?.projects.find(
          (pr) => pr.id === pane?.projectId,
        )?.root;
        const cwd = pane?.cwd ?? paneProjectRoot ?? useWorkspaceStore.getState().activeCwd();
        const { id, shell } = await spawnPty(undefined, rows, cols, cwd);
        if (cancelled) {
          await killPty(id);
          term.dispose();
          return;
        }
        sessionIdRef.current = id;
        useWorkspaceStore.getState().setSessionId(paneId, id, shell, cwd);
        useWorkspaceStore.getState().setActiveTerminal(id);

        if (pane?.startupCommand) {
          writePty(id, `${pane.startupCommand}\n`).catch(console.error);
          if (!pane.overlay) {
            useWorkspaceStore.getState().clearPaneStartupCommand(paneId);
          }
        }

        divRef.current?.addEventListener("mousedown", makeActive);

        term.onData((data) => {
          writePty(id, data).catch(console.error);
          watcher.onInput(data);
        });

        term.onResize(({ cols, rows }) => {
          resizePty(id, rows, cols).catch(console.error);
        });

        const unlistenDataPromise = onPtyData((payload) => {
          if (payload.id !== id) return;
          const binaryStr = atob(payload.chunk_b64);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
          watcher.onOutput(binaryStr);
          // A burst of output right after a keystroke is usually just the
          // shell echoing back what was typed, not the agent doing work —
          // only flag "running" once a line has actually been submitted.
          if (!watcher.isTypingLine()) markRunning();
          term.write(bytes);
        });

        const unlistenExitPromise = onPtyExit((payload) => {
          if (payload.id !== id) return;
          if (runningTimeout) clearTimeout(runningTimeout);
          useWorkspaceStore.getState().setPaneRunning(paneId, false);
          if (autoTagged) {
            // The agent this pane was auto-tagged for has actually ended
            // (the whole session exited) — clear the tag so it drops out of
            // the sidebar's Agents list instead of lingering as a stale
            // entry until the pane itself is closed. Only ever clears a tag
            // this same pane instance applied automatically, never one the
            // user set by hand.
            useWorkspaceStore.getState().renamePane(paneId, undefined);
            useWorkspaceStore.getState().setPaneColor(paneId, undefined);
          }
          term.writeln("\r\n[session ended]");
        });

        unlistenData = await unlistenDataPromise;
        unlistenExit = await unlistenExitPromise;
        if (cancelled) {
          unlistenData();
          unlistenExit();
          await killPty(id);
          term.dispose();
          return;
        }

        unsubSettings = useWorkspaceStore.subscribe((s) => {
          const st = s.settings;
          const resized = term.options.fontSize !== st.fontSize;
          term.options.fontSize = st.fontSize;
          term.options.cursorStyle = st.cursorStyle;
          term.options.cursorBlink = st.cursorBlink;
          term.options.scrollback = st.scrollback;
          term.options.theme = resolveTheme(st.theme);
          if (resized) {
            try {
              fitAddon.fit();
            } catch {
              // ignored
            }
          }
        });

        let lastActiveTerminalId: string | null | undefined;
        unsubActive = useWorkspaceStore.subscribe((s) => {
          const activeId = s.getActiveWorkspace()?.activeTerminalId;
          if (activeId === lastActiveTerminalId) return;
          lastActiveTerminalId = activeId;
          if (activeId && activeId === sessionIdRef.current) {
            term.focus();
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

        watcher.start();
      } catch (e) {
        term.writeln(`\r\n[failed to spawn terminal: ${e}]`);
      }
    };

    start();

    return () => {
      cancelled = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId]);

  const runSearch = (dir: "next" | "prev") => {
    if (!searchQuery) return;
    if (dir === "next") searchAddonRef.current?.findNext(searchQuery);
    else searchAddonRef.current?.findPrevious(searchQuery);
  };

  const closeSearch = () => {
    setSearchOpen(false);
    searchAddonRef.current?.clearDecorations();
  };

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={divRef} className="h-full w-full outline-none p-2" tabIndex={0} />
      {searchOpen && (
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-lg border border-white/10 bg-[#1d1811]/95 px-1.5 py-1 shadow-lg shadow-black/40 backdrop-blur">
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (e.target.value) searchAddonRef.current?.findNext(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") runSearch(e.shiftKey ? "prev" : "next");
              if (e.key === "Escape") closeSearch();
            }}
            placeholder="Find in terminal"
            spellCheck={false}
            className="w-40 bg-transparent px-1.5 py-0.5 text-[11px] font-mono text-[#f3e9d8] placeholder:text-[#6f6455] outline-none"
          />
          <button
            onClick={() => runSearch("prev")}
            className="p-1 rounded text-[#a99a86] hover:text-accent hover:bg-[#2a2318]/60"
            title="Previous match"
          >
            <ChevronUp size={12} />
          </button>
          <button
            onClick={() => runSearch("next")}
            className="p-1 rounded text-[#a99a86] hover:text-accent hover:bg-[#2a2318]/60"
            title="Next match"
          >
            <ChevronDown size={12} />
          </button>
          <button
            onClick={closeSearch}
            className="p-1 rounded text-[#a99a86] hover:text-rose-300 hover:bg-rose-500/20"
            title="Close search"
          >
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
