import { Sidebar } from "./components/Sidebar";
import { TerminalPane } from "./components/TerminalPane";

function App() {
  return (
    <div className="h-screen w-screen bg-slate-950 text-slate-100 flex overflow-hidden">
      <Sidebar />
      <div className="flex-1 p-2 min-w-0">
        <TerminalPane />
      </div>
    </div>
  );
}

export default App;
