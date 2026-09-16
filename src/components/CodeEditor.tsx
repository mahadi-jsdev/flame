import CodeMirror from "@uiw/react-codemirror";
import { useEffect, useState } from "react";
import type { Extension } from "@codemirror/state";
import { languageServerWithTransport } from "codemirror-languageserver";
import { languageForPath, lspLanguageIdForPath } from "../lib/codeLang";
import { flameCodeTheme } from "../lib/codeTheme";
import { getLspSession, pathToFileUri } from "../lib/lspClient";

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  path: string;
  absPath: string;
  projectRoot: string;
  autoFocus?: boolean;
}

export function CodeEditor({
  value,
  onChange,
  path,
  absPath,
  projectRoot,
  autoFocus,
}: CodeEditorProps) {
  const [lspExtensions, setLspExtensions] = useState<Extension[]>([]);

  useEffect(() => {
    const languageId = lspLanguageIdForPath(path);
    if (!languageId) {
      setLspExtensions([]);
      return;
    }

    let cancelled = false;
    const documentUri = pathToFileUri(absPath);
    const rootUri = pathToFileUri(projectRoot);

    getLspSession(projectRoot, documentUri, languageId).then((session) => {
      if (cancelled || !session) return;
      setLspExtensions(
        languageServerWithTransport({
          client: session.client,
          transport: session.transport,
          documentUri,
          languageId,
          rootUri,
          workspaceFolders: [
            { uri: rootUri, name: projectRoot.split("/").pop() ?? projectRoot },
          ],
          // Hover/completion docs come from JSDoc comments in the project's
          // own files and its dependencies' .d.ts files — untrusted content
          // that codemirror-languageserver renders via innerHTML. The app's
          // CSP (src-tauri/tauri.conf.json) is what actually neutralizes an
          // injected <script>/onerror payload; this flag is the honest value
          // on top of it, since Flame never wants server-supplied HTML.
          allowHTMLContent: false,
        }),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [path, absPath, projectRoot]);

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={[...languageForPath(path), ...flameCodeTheme, ...lspExtensions]}
      theme="none"
      autoFocus={autoFocus}
      basicSetup={{ highlightActiveLine: true, foldGutter: true }}
      height="100%"
      style={{ height: "100%" }}
    />
  );
}
