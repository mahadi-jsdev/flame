import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
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
}

const TERM_FONT =
  '"JetBrainsMono Nerd Font Mono", "JetBrainsMono NFM", "JetBrainsMono Nerd Font", "JetBrains Mono", "Fira Code", "Cascadia Code", "SF Mono", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

export function TerminalPane({ paneId }: TerminalPaneProps) {
  const divRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string>("");
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

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

    const maybeNotify = async (command: string) => {
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
        const agent = agentName(command);
        await mod.sendNotification({
          title: agent ? `${agent} finished` : "Terminal task finished",
          body: command || "A task completed or is waiting for input",
        });
      } catch {
        // notifications unavailable
      }
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
    const searchAddon = new SearchAddon();
    term.loadAddon(searchAddon);
    searchAddonRef.current = searchAddon;

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
      term.dispose();
    };

    const start = async () => {
      try {
        await document.fonts.load('400 14px "JetBrainsMono Nerd Font Mono"');
        await document.fonts.load('700 14px "JetBrainsMono Nerd Font Mono"');

        term.open(divRef.current!);
        fitAddon.fit();

        term.attachCustomKeyEventHandler((e) => {
          if (e.type !== "keydown") return true;
          const ctrlOrCmd = e.ctrlKey || e.metaKey;
          if (ctrlOrCmd && e.key.toLowerCase() === "f") {
            setSearchOpen(true);
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
          watcher.onOutput();
          markRunning();
          const bytes = new Uint8Array(
            atob(payload.chunk_b64)
              .split("")
              .map((c) => c.charCodeAt(0)),
          );
          term.write(bytes);
        });

        const unlistenExitPromise = onPtyExit((payload) => {
          if (payload.id !== id) return;
          if (runningTimeout) clearTimeout(runningTimeout);
          useWorkspaceStore.getState().setPaneRunning(paneId, false);
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
    <div className="relative h-full w-full">
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
