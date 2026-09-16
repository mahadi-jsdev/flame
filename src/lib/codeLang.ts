import type { Extension } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { yaml } from "@codemirror/lang-yaml";
import { go } from "@codemirror/lang-go";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";

/** Best-effort by file extension — an unrecognized one just means plain,
 * unhighlighted text, same as today. */
export function languageForPath(path: string): Extension[] {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "ts":
      return [javascript({ typescript: true })];
    case "tsx":
      return [javascript({ jsx: true, typescript: true })];
    case "js":
    case "mjs":
    case "cjs":
      // .js commonly holds JSX too (Next.js/CRA projects that don't use the
      // .jsx extension) — enabling JSX parsing is a harmless superset for
      // plain JS files and required for these, so it's on unconditionally.
      return [javascript({ jsx: true })];
    case "jsx":
      return [javascript({ jsx: true })];
    case "json":
      return [json()];
    case "css":
      return [css()];
    case "html":
    case "htm":
      return [html()];
    case "md":
    case "markdown":
      return [markdown()];
    case "py":
      return [python()];
    case "rs":
      return [rust()];
    case "sql":
      return [sql()];
    case "yml":
    case "yaml":
      return [yaml()];
    case "go":
      return [go()];
    case "c":
    case "h":
    case "cpp":
    case "cc":
    case "hpp":
      return [cpp()];
    case "java":
      return [java()];
    default:
      return [];
  }
}

/** LSP `languageId` for JS/TS files only — null means "not LSP-eligible",
 * same file-extension switch as languageForPath above. */
export function lspLanguageIdForPath(
  path: string,
): "typescript" | "typescriptreact" | "javascript" | "javascriptreact" | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "ts":
      return "typescript";
    case "tsx":
      return "typescriptreact";
    case "js":
    case "mjs":
    case "cjs":
      return "javascript";
    case "jsx":
      return "javascriptreact";
    default:
      return null;
  }
}
