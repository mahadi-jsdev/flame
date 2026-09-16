import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// Uses CSS custom properties (var(--color-accent)) rather than a fixed hex
// so the editor automatically follows whichever terminal theme is active,
// instead of clashing with it. Everything else reuses hues already meaningful
// elsewhere in the app (agent tag colors, git status colors) so the editor
// reads as part of Flame rather than a bolted-on generic code theme.
const editorTheme = EditorView.theme(
  {
    "&": {
      color: "#f3e9d8",
      backgroundColor: "#0e0b08",
      height: "100%",
      fontSize: "12px",
    },
    ".cm-content": {
      fontFamily:
        '"JetBrainsMono Nerd Font Mono", "JetBrains Mono", "Fira Code", monospace',
      caretColor: "var(--color-accent)",
    },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-accent)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "color-mix(in srgb, var(--color-accent) 25%, transparent)",
    },
    ".cm-activeLine, .cm-activeLineGutter": {
      backgroundColor: "rgba(255,255,255,0.03)",
    },
    ".cm-gutters": {
      backgroundColor: "#0e0b08",
      color: "#6f6455",
      border: "none",
    },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 4px" },
    "&.cm-focused": { outline: "none" },
    ".cm-matchingBracket, .cm-nonmatchingBracket": {
      backgroundColor: "color-mix(in srgb, var(--color-accent) 18%, transparent)",
      outline: "1px solid color-mix(in srgb, var(--color-accent) 40%, transparent)",
    },
    ".cm-foldPlaceholder": {
      backgroundColor: "transparent",
      border: "1px solid #6f6455",
      color: "#a99a86",
    },
  },
  { dark: true },
);

const highlightStyle = HighlightStyle.define([
  { tag: t.comment, color: "#6f6455", fontStyle: "italic" },
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: "var(--color-accent)" },
  { tag: [t.string, t.special(t.string)], color: "#8fcf8a" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "#ffcb6b" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#8bb4e8" },
  { tag: [t.className, t.typeName], color: "#c9a877" },
  { tag: [t.definition(t.variableName), t.propertyName], color: "#f3e9d8" },
  { tag: t.variableName, color: "#d9cbb5" },
  { tag: [t.operator, t.punctuation, t.bracket, t.separator], color: "#a99a86" },
  { tag: t.tagName, color: "#ff6b52" },
  { tag: t.attributeName, color: "var(--color-accent-2)" },
  { tag: t.invalid, color: "#fda4af", textDecoration: "underline wavy" },
  { tag: t.link, color: "#8bb4e8", textDecoration: "underline" },
  { tag: t.heading, color: "var(--color-accent)", fontWeight: "700" },
  { tag: t.meta, color: "#6f6455" },
]);

export const flameCodeTheme = [editorTheme, syntaxHighlighting(highlightStyle)];
