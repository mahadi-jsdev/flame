import { useState } from "react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { writePty } from "../lib/tauri";

export function ChatPane() {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const activeTerminalId = useWorkspaceStore((s) => s.activeTerminalId);

  const send = () => {
    if (!input.trim()) return;
    setHistory((h) => [...h, `> ${input}`]);
    if (activeTerminalId) {
      writePty(activeTerminalId, `${input}\r\n`).catch(console.error);
    }
    setInput("");
  };

  return (
    <div className="h-full w-full flex flex-col p-2">
      <div className="flex-1 overflow-auto text-sm space-y-1">
        {history.map((m, i) => (
          <div key={i} className="text-slate-300">
            {m}
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm"
          placeholder={activeTerminalId ? "Type a command..." : "No active terminal"}
        />
        <button onClick={send} className="px-3 py-1 bg-slate-800 hover:bg-slate-700 rounded text-sm">
          Send
        </button>
      </div>
    </div>
  );
}
