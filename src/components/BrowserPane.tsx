import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

export function BrowserPane() {
  const [url, setUrl] = useState("http://localhost:3000");
  const [error, setError] = useState<string | null>(null);

  const handleError = () => {
    setError("This page cannot be shown in the preview. Open it in your default browser instead.");
  };

  return (
    <div className="h-full w-full flex flex-col">
      <div className="flex gap-2 p-2 bg-slate-900 border-b border-slate-800 items-center">
        <input
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && setError(null)}
          className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-sm"
        />
        <button
          onClick={() => openUrl(url).catch(() => setError("Could not open URL"))}
          className="px-3 py-1 bg-slate-800 hover:bg-slate-700 rounded text-sm"
        >
          Open
        </button>
      </div>
      <div className="flex-1 relative">
        <iframe
          src={url}
          className="h-full w-full"
          sandbox="allow-scripts allow-same-origin allow-forms"
          title="browser-preview"
          onError={handleError}
        />
        {error && (
          <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center p-4 text-center">
            <p className="text-slate-300 mb-2">{error}</p>
            <button
              onClick={() => openUrl(url).catch(() => {})}
              className="px-3 py-1 bg-slate-800 hover:bg-slate-700 rounded text-sm"
            >
              Open in Browser
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
