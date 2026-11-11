import { EditorView } from "@codemirror/view";
import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

const MONO =
  "'JetBrains Mono', 'Cascadia Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";

const editorTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "#151514",
      color: "#e6ebf1",
      fontSize: "14px",
      height: "100%",
    },
    ".cm-content": {
      fontFamily: MONO,
      lineHeight: "25px",
      padding: "12px 0",
      caretColor: "#34d399",
    },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#34d399" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "rgba(52, 211, 153, 0.22)",
    },
    ".cm-activeLine": { backgroundColor: "rgba(255, 255, 255, 0.025)" },
    ".cm-activeLineGutter": {
      backgroundColor: "rgba(255, 255, 255, 0.025)",
      color: "#94a1b3",
    },
    ".cm-gutters": {
      backgroundColor: "#151514",
      color: "#4f5a6d",
      border: "none",
      fontFamily: MONO,
      lineHeight: "25px",
      padding: "12px 0",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      minWidth: "44px",
      padding: "0 8px 0 12px",
    },
    ".cm-foldGutter .cm-gutterElement": {
      color: "#77849a",
      padding: "0 6px 0 2px",
    },
    ".cm-matchingBracket": {
      backgroundColor: "rgba(16, 185, 129, 0.2)",
      outline: "1px solid rgba(16, 185, 129, 0.5)",
    },
    ".cm-nonmatchingBracket": {
      backgroundColor: "rgba(239, 68, 68, 0.25)",
      outline: "1px solid rgba(239, 68, 68, 0.6)",
    },
    ".cm-searchMatch": {
      backgroundColor: "rgba(217, 119, 6, 0.35)",
      outline: "1px solid rgba(217, 119, 6, 0.55)",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "rgba(52, 211, 153, 0.3)",
      outline: "1px solid rgba(52, 211, 153, 0.65)",
    },
    ".cm-panels": {
      backgroundColor: "#1b1a18",
      color: "#d0d8e2",
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      fontSize: "12px",
      padding: "6px 8px",
    },
    ".cm-panels.cm-panels-top": { borderBottom: "1px solid #2a2927" },
    ".cm-panels.cm-panels-bottom": { borderTop: "1px solid #2a2927" },
    ".cm-panels input": {
      backgroundColor: "#111110",
      color: "#e6ebf1",
      border: "1px solid #3d3c39",
      borderRadius: "4px",
      font: "inherit",
      padding: "2px 6px",
    },
    ".cm-panels button": {
      backgroundColor: "#111110",
      color: "#e6ebf1",
      border: "1px solid #3d3c39",
      borderRadius: "4px",
      font: "inherit",
      padding: "1px 6px",
      marginLeft: "4px",
      cursor: "pointer",
    },
    ".cm-panels button:hover": { backgroundColor: "#2a2927" },
    ".cm-panels label": { margin: "0 4px 0 8px" },
    ".cm-tooltip": {
      backgroundColor: "#1b1a18",
      color: "#e6ebf1",
      border: "1px solid #3d3c39",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "rgba(52, 211, 153, 0.16)",
      color: "#e6ebf1",
    },
    ".cm-tooltip-autocomplete ul li": { color: "#94a1b3" },
    ".cm-placeholder": { color: "#5d6a80" },
    "&.cm-focused": { outline: "none" },
  },
  { dark: true },
);

const editorHighlight = HighlightStyle.define([
  { tag: t.comment, color: "#7f848e", fontStyle: "italic" },
  {
    tag: [t.keyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword],
    color: "#c678dd",
  },
  { tag: [t.string, t.special(t.string), t.docString], color: "#98c379" },
  { tag: t.regexp, color: "#98c379" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "#d19a66" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#61afef" },
  { tag: [t.variableName, t.self, t.labelName], color: "#e06c75" },
  { tag: [t.className, t.typeName, t.namespace], color: "#e5c07b" },
  { tag: [t.propertyName, t.attributeName], color: "#d19a66" },
  { tag: [t.tagName, t.angleBracket], color: "#e06c75" },
  { tag: [t.operator, t.punctuation], color: "#a8b2c0" },
  { tag: [t.meta, t.processingInstruction], color: "#7f848e" },
  { tag: t.heading, color: "#e06c75", fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.link, color: "#61afef", textDecoration: "underline" },
  { tag: t.monospace, color: "#e5c07b" },
]);

export { editorTheme, editorHighlight };
