import { snippet, snippetCompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorState, type Extension } from "@codemirror/state";
import { useTabs } from "@/stores/tabs";
import { useUi } from "@/stores/ui";
import { viewFor } from "@/features/exthost/views";
import { featureText } from "@/i18n/features";
import { useSnippets } from "@/features/snippets/store";
import { escapeBody, extOf, snippetApplies, type Snippet } from "@/features/snippets/model";
import { toCmTemplate } from "@/features/snippets/template";

/** Autocomplete source: user snippets matching the file extension, by prefix. */
function snippetSource(path: string) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const word = ctx.matchBefore(/[\w-]+/);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    // Read the store on every request so edits apply without reopening the file.
    const list = useSnippets.getState().snippets.filter((s) => snippetApplies(s, path));
    if (list.length === 0) return null;
    return {
      from: word.from,
      options: list.map((s) =>
        snippetCompletion(toCmTemplate(s.body), {
          label: s.prefix,
          detail: s.name,
          info: s.description || undefined,
          type: "text",
        }),
      ),
      validFor: /^[\w-]*$/,
    };
  };
}

/** Adds the snippet source next to the language's own completions. */
export function snippetCompletions(path: string): Extension {
  return EditorState.languageData.of(() => [{ autocomplete: snippetSource(path) }]);
}

function activeView() {
  const tabs = useTabs.getState();
  const active = tabs.tabs.find((t) => t.id === tabs.activeId);
  return active ? viewFor(active.path) : undefined;
}

/** Inserts at the main selection of the active editor; returns false when no editor is open. */
export function insertSnippet(s: Snippet): boolean {
  const view = activeView();
  if (!view) {
    useTabs.getState().setError(featureText().noEditor);
    return false;
  }
  const sel = view.state.selection.main;
  snippet(toCmTemplate(s.body))(view, null, sel.from, sel.to);
  view.focus();
  return true;
}

/** Opens the snippet form prefilled with the selected code of the given file. */
export function newSnippetFromSelection(path: string) {
  const view = viewFor(path);
  const sel = view?.state.selection.main;
  const text = view && sel && !sel.empty ? view.state.sliceDoc(sel.from, sel.to) : "";
  useSnippets.getState().startEdit(null, { body: escapeBody(text), langs: extOf(path) });
  useUi.getState().setPanel("snippets");
}
