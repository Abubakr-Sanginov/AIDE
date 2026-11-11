import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t, type Tag } from "@lezer/highlight";
import type { TokenRule, VsTheme } from "./manifest";

// VS Code color theme → CodeMirror theme + highlight style. TextMate scopes are mapped to
// the closest CodeMirror tags by prefix (longest prefix wins), so the result is an
// approximation of the original theme, not a pixel-exact copy.

const SCOPE_TAGS: [string, Tag[]][] = [
  ["comment", [t.comment]],
  ["string", [t.string, t.special(t.string)]],
  ["string.regexp", [t.regexp]],
  ["constant.numeric", [t.number]],
  ["constant.language", [t.bool, t.null, t.atom]],
  ["constant.character.escape", [t.escape]],
  ["constant", [t.atom]],
  ["support.constant", [t.atom]],
  ["keyword", [t.keyword, t.moduleKeyword, t.controlKeyword]],
  ["keyword.operator", [t.operator, t.operatorKeyword]],
  ["storage", [t.definitionKeyword, t.modifier]],
  ["entity.name.function", [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))]],
  ["support.function", [t.function(t.variableName)]],
  ["meta.function-call", [t.function(t.variableName)]],
  ["entity.name.type", [t.typeName, t.className]],
  ["entity.name.class", [t.className]],
  ["support.class", [t.className]],
  ["support.type", [t.typeName]],
  ["entity.name.namespace", [t.namespace]],
  ["entity.name.tag", [t.tagName]],
  ["entity.other.attribute-name", [t.attributeName]],
  ["variable", [t.variableName]],
  ["variable.parameter", [t.variableName]],
  ["variable.other.property", [t.propertyName]],
  ["variable.other.object.property", [t.propertyName]],
  ["support.type.property-name", [t.propertyName]],
  ["variable.language", [t.self]],
  ["punctuation", [t.punctuation, t.bracket, t.separator]],
  ["punctuation.definition.tag", [t.angleBracket]],
  ["meta", [t.meta]],
  ["invalid", [t.invalid]],
  ["markup.heading", [t.heading]],
  ["markup.bold", [t.strong]],
  ["markup.italic", [t.emphasis]],
  ["markup.underline.link", [t.link, t.url]],
  ["markup.inline.raw", [t.monospace]],
];

function tagsFor(scope: string): Tag[] | null {
  let best: [string, Tag[]] | null = null;
  for (const entry of SCOPE_TAGS) {
    if ((scope === entry[0] || scope.startsWith(entry[0] + ".")) && (!best || entry[0].length > best[0].length)) best = entry;
  }
  return best ? best[1] : null;
}

function styleOf(s: TokenRule["settings"]): Record<string, string> | null {
  const out: Record<string, string> = {};
  if (s.foreground) out.color = s.foreground;
  const fs = s.fontStyle ?? "";
  if (fs.includes("italic")) out.fontStyle = "italic";
  if (fs.includes("bold")) out.fontWeight = "bold";
  if (fs.includes("underline")) out.textDecoration = "underline";
  return Object.keys(out).length > 0 ? out : null;
}

export function highlightFromTheme(theme: VsTheme): HighlightStyle {
  const specs: { tag: Tag | Tag[]; [k: string]: unknown }[] = [];
  for (const rule of theme.tokenColors) {
    const style = styleOf(rule.settings);
    if (!style || rule.scope === undefined) continue;
    const scopes = (Array.isArray(rule.scope) ? rule.scope : rule.scope.split(",")).map((s) => s.trim()).filter(Boolean);
    for (const scope of scopes) {
      // "source.ts meta.x.y" → the last, most specific selector part
      const last = scope.split(/\s+/).pop() ?? scope;
      const tags = tagsFor(last);
      if (tags) specs.push({ tag: tags, ...style });
    }
  }
  return HighlightStyle.define(specs as Parameters<typeof HighlightStyle.define>[0]);
}

const MONO =
  "'JetBrains Mono', 'Cascadia Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";

export function themeExtension(theme: VsTheme): Extension {
  const c = theme.colors;
  const bg = c["editor.background"] ?? (theme.dark ? "#1e1e1e" : "#ffffff");
  const fg = c["editor.foreground"] ?? (theme.dark ? "#d4d4d4" : "#333333");
  const cursor = c["editorCursor.foreground"] ?? fg;
  const selection = c["editor.selectionBackground"] ?? (theme.dark ? "#264f78" : "#add6ff");
  const lineHl = c["editor.lineHighlightBackground"] ?? (theme.dark ? "#ffffff10" : "#00000010");
  const gutterFg = c["editorLineNumber.foreground"] ?? (theme.dark ? "#858585" : "#237893");
  const gutterActive = c["editorLineNumber.activeForeground"] ?? fg;
  const gutterBg = c["editorGutter.background"] ?? bg;
  const widgetBg = c["editorWidget.background"] ?? bg;
  const widgetFg = c["editorWidget.foreground"] ?? fg;
  const border = c["editorWidget.border"] ?? "#8884";
  const bracket = c["editorBracketMatch.background"] ?? "#8884";
  const bracketBorder = c["editorBracketMatch.border"] ?? "#8886";
  const find = c["editor.findMatchHighlightBackground"] ?? "#ea5c0055";
  const findActive = c["editor.findMatchBackground"] ?? "#515c6a";

  const view = EditorView.theme(
    {
      "&": { backgroundColor: bg, color: fg },
      ".cm-content": { caretColor: cursor, fontFamily: MONO },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: cursor },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: selection },
      ".cm-activeLine": { backgroundColor: lineHl },
      ".cm-gutters": { backgroundColor: gutterBg, color: gutterFg },
      ".cm-activeLineGutter": { backgroundColor: lineHl, color: gutterActive },
      ".cm-matchingBracket": { backgroundColor: bracket, outline: `1px solid ${bracketBorder}` },
      ".cm-searchMatch": { backgroundColor: find, outline: "none" },
      ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: findActive },
      ".cm-panels": { backgroundColor: widgetBg, color: widgetFg },
      ".cm-tooltip": { backgroundColor: widgetBg, color: widgetFg, border: `1px solid ${border}` },
      ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
        backgroundColor: c["list.activeSelectionBackground"] ?? selection,
        color: c["list.activeSelectionForeground"] ?? widgetFg,
      },
    },
    { dark: theme.dark },
  );
  return [view, syntaxHighlighting(highlightFromTheme(theme))];
}

/** Theme background, reused by the textmate highlighter as its default foreground. */
export function defaultForeground(theme: VsTheme | null): string {
  return theme?.colors["editor.foreground"] ?? "#e6ebf1";
}
