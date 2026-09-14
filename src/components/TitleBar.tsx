import { useEffect, useState } from "react";
import { Cpu, Minus, Square, Copy, X } from "lucide-react";

async function getWin() {
  try {
    if (!("__TAURI_INTERNALS__" in window)) return null;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow();
  } catch {
    return null;
  }
}

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      const win = await getWin();
      if (!win) return;
      setIsMaximized(await win.isMaximized());
      unlisten = await win.onResized(async () => {
        setIsMaximized(await win.isMaximized());
      });
    })();
    return () => unlisten?.();
  }, []);

  return (
    <div
      data-tauri-drag-region
      className="h-8 shrink-0 flex items-center justify-between pl-3 bg-[#15110c] border-b border-white/10 select-none"
    >
      <div
        data-tauri-drag-region
        className="flex items-center gap-2 text-[11px] font-display font-medium tracking-wide text-[#a99a86] pointer-events-none"
      >
        <Cpu size={12} className="text-accent" />
        Hangar
      </div>
      <div className="flex items-center h-full">
        <button
          onClick={async () => (await getWin())?.minimize()}
          className="h-8 w-11 flex items-center justify-center text-[#a99a86] hover:bg-white/[0.06] hover:text-[#f3e9d8] transition-colors"
          title="Minimize"
        >
          <Minus size={13} />
        </button>
        <button
          onClick={async () => (await getWin())?.toggleMaximize()}
          className="h-8 w-11 flex items-center justify-center text-[#a99a86] hover:bg-white/[0.06] hover:text-[#f3e9d8] transition-colors"
          title={isMaximized ? "Restore" : "Maximize"}
        >
          {isMaximized ? (
            <Copy size={11} className="-scale-x-100" />
          ) : (
            <Square size={11} />
          )}
        </button>
        <button
          onClick={async () => (await getWin())?.close()}
          className="h-8 w-11 flex items-center justify-center text-[#a99a86] hover:bg-rose-600 hover:text-white transition-colors"
          title="Close window"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
