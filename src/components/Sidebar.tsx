import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { File, Folder } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";

export function Sidebar() {
  const { root, entries, setRoot } = useWorkspaceStore();

  const handleOpenFolder = async () => {
    const path = await open({ directory: true });
    if (typeof path !== "string") return;
    const list = await invoke<{ name: string; path: string; is_dir: boolean }[]>(
      "list_dir",
      { path }
    );
    setRoot(path, list);
  };

  return (
    <div className="w-64 h-full bg-slate-900 border-r border-slate-800 flex flex-col">
      <button
        onClick={handleOpenFolder}
        className="m-2 p-2 bg-slate-800 hover:bg-slate-700 rounded text-sm text-left"
      >
        Open Folder
      </button>
      {root && (
        <div className="px-3 text-xs text-slate-400 truncate" title={root}>
          {root}
        </div>
      )}
      <div className="flex-1 overflow-auto p-2 text-sm space-y-1">
        {entries.map((e) => (
          <div key={e.path} className="flex items-center gap-2 py-1 px-1 rounded hover:bg-slate-800">
            {e.is_dir ? <Folder size={14} /> : <File size={14} />}
            <span className="truncate">{e.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
