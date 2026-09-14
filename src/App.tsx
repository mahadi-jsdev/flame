import { useEffect } from "react";
import { Workspace } from "./components/Workspace";
import { useWorkspaceStore } from "./store/workspaceStore";
import { applyUiTheme } from "./lib/themes";

function App() {
  const theme = useWorkspaceStore((s) => s.settings.theme);

  useEffect(() => {
    applyUiTheme(theme);
  }, [theme]);

  return <Workspace />;
}

export default App;
