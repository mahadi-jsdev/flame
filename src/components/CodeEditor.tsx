import CodeMirror from "@uiw/react-codemirror";
import { languageForPath } from "../lib/codeLang";
import { flameCodeTheme } from "../lib/codeTheme";

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  path: string;
  autoFocus?: boolean;
}

export function CodeEditor({ value, onChange, path, autoFocus }: CodeEditorProps) {
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={[...languageForPath(path), ...flameCodeTheme]}
      theme="none"
      autoFocus={autoFocus}
      basicSetup={{ highlightActiveLine: true, foldGutter: true }}
      height="100%"
      style={{ height: "100%" }}
    />
  );
}
