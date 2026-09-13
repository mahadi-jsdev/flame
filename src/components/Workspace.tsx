import { useEffect } from "react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { Sidebar } from "./Sidebar";
import { TerminalPane } from "./TerminalPane";
import { ChatPane } from "./ChatPane";
import { BrowserPane } from "./BrowserPane";
import { Group, Panel, Separator } from "react-resizable-panels";

export function Workspace() {
  const { panes, addPane, removePane } = useWorkspaceStore();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const ctrlOrCmd = e.ctrlKey || e.metaKey;
      if (!ctrlOrCmd || !e.shiftKey) return;

      switch (e.key.toLowerCase()) {
        case "t":
          e.preventDefault();
          addPane("terminal");
          break;
        case "c":
          e.preventDefault();
          addPane("chat");
          break;
        case "b":
          e.preventDefault();
          addPane("browser");
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [addPane]);

  return (
    <div className="h-screen w-screen bg-slate-950 text-slate-100 flex overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-10 flex items-center gap-2 px-2 bg-slate-900 border-b border-slate-800 shrink-0">
          <button
            onClick={() => addPane("terminal")}
            className="px-2 py-1 text-xs bg-slate-800 hover:bg-slate-700 rounded"
          >
            + Terminal
          </button>
          <button
            onClick={() => addPane("chat")}
            className="px-2 py-1 text-xs bg-slate-800 hover:bg-slate-700 rounded"
          >
            + Chat
          </button>
          <button
            onClick={() => addPane("browser")}
            className="px-2 py-1 text-xs bg-slate-800 hover:bg-slate-700 rounded"
          >
            + Browser
          </button>
        </div>
        <Group orientation="horizontal" className="flex-1 min-h-0">
          {panes.map((pane, index) => (
            <>
              <Panel
                key={pane.id}
                defaultSize={100 / panes.length}
                minSize={15}
                className="flex flex-col"
              >
                <div className="h-full w-full flex flex-col border border-slate-800 bg-slate-950 overflow-hidden">
                  <div className="flex justify-end px-2 py-1 bg-slate-900 border-b border-slate-800">
                    <button
                      onClick={() => removePane(pane.id)}
                      className="text-xs text-slate-400 hover:text-slate-100"
                    >
                      ×
                    </button>
                  </div>
                  <div className="flex-1 min-h-0">
                    {pane.type === "terminal" && <TerminalPane paneId={pane.id} />}
                    {pane.type === "chat" && <ChatPane />}
                    {pane.type === "browser" && <BrowserPane />}
                  </div>
                </div>
              </Panel>
              {index < panes.length - 1 && (
                <Separator className="w-1 bg-slate-800 hover:bg-slate-600" />
              )}
            </>
          ))}
        </Group>
      </div>
    </div>
  );
}
