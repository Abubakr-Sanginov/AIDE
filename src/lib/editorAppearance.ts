import { Prec, type Extension } from "@codemirror/state";
import { syntaxHighlighting } from "@codemirror/language";
import { useExtensions } from "@/features/extensions/store";
import { themeExtension } from "@/features/extensions/themeExt";
import { editorHighlight } from "@/lib/editorTheme";

/** Colors for an editor: the installed VS Code theme, or the built-in highlight style. */
export function appearanceFor(): Extension {
  const theme = useExtensions.getState().theme;
  return theme ? Prec.highest(themeExtension(theme)) : syntaxHighlighting(editorHighlight);
}
