import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, hoverTooltip, keymap } from "@codemirror/view";
import { snippet, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { languageIdForPath } from "@/features/extensions/editorExt";
import { toTemplate } from "@/features/extensions/manifest";
import { useTabs } from "@/stores/tabs";
import { flushDocs } from "./docSync";
import { useExtHost, type Diag } from "./store";
import { offsetOf } from "./views";

// CodeMirror side of the extension host: completion, hover, formatting, go to definition
// and diagnostics provided by VS Code extensions.

const KIND_TYPE: Record<number, string> = {
  0: "text", 1: "method", 2: "function", 3: "function", 4: "property", 5: "variable", 6: "class", 7: "interface", 8: "namespace", 9: "property",
  11: "constant", 12: "enum", 13: "keyword", 14: "text", 15: "constant", 16: "text", 17: "text", 19: "enum", 20: "constant", 21: "class", 22: "text", 24: "keyword", 25: "type",
};

function selectorMatches(sel: { language?: string; pattern?: string }[], lang: string | null, path: string): boolean {
  return sel.some((s) => {
    if (s.language && s.language !== "*" && s.language !== lang) return false;
    if (s.pattern) {
      const re = new RegExp("^" + s.pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\/?/g, "\u0001").replace(/\*/g, "[^/]*").replace(/\u0001/g, ".*") + "$", "i");
      if (!re.test(path.replace(/\\/g, "/"))) return false;
    }
    return true;
  });
}

function providersFor(kind: string, path: string) {
  const lang = languageIdForPath(path);
  return (useExtHost.getState().providers[kind] ?? []).filter((p) => selectorMatches(p.selector, lang, path));
}

const posOf = (view: EditorView, offset: number): [number, number] => {
  const line = view.state.doc.lineAt(offset);
  return [line.number - 1, offset - line.from];
};

interface RawItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string;
  insertText?: string;
  snippet?: boolean;
  sortText?: string;
  filterText?: string;
  range: [number, number, number, number] | null;
  textEdit?: string;
  additionalTextEdits?: { range: [number, number, number, number]; newText: string }[];
  preselect?: boolean;
}

function completionSource(path: string) {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const providers = providersFor("completion", path);
    if (providers.length === 0 || useExtHost.getState().status !== "ready") return null;
    const word = ctx.matchBefore(/[\w$@#.:\-/]*/);
    const prev = ctx.pos > 0 ? ctx.state.sliceDoc(ctx.pos - 1, ctx.pos) : "";
    const triggers = providers.flatMap((p) => p.triggerCharacters);
    if (!ctx.explicit && (!word || word.from === word.to) && !triggers.includes(prev)) return null;
    flushDocs();
    const [line, character] = [ctx.state.doc.lineAt(ctx.pos).number - 1, ctx.pos - ctx.state.doc.lineAt(ctx.pos).from];
    let items: RawItem[];
    try {
      items = await useExtHost.getState().call<RawItem[]>("provide.completion", { path, line, character, triggerCharacter: triggers.includes(prev) ? prev : undefined }, 10_000);
    } catch {
      return null;
    }
    if (!Array.isArray(items) || items.length === 0) return null;
    const from = word ? word.from : ctx.pos;
    const options: Completion[] = items.slice(0, 500).map((it) => ({
      label: String(it.label ?? ""),
      detail: it.detail ? String(it.detail).slice(0, 80) : undefined,
      info: it.documentation ? String(it.documentation).slice(0, 2000) : undefined,
      type: KIND_TYPE[it.kind ?? 0] ?? "text",
      boost: it.preselect ? 50 : 0,
      apply: (view, completion, f, t) => {
        const text = it.textEdit ?? it.insertText ?? it.label;
        let start = f;
        let end = t;
        if (it.range) {
          start = offsetOf(view, it.range[0], it.range[1]);
          end = offsetOf(view, it.range[2], it.range[3]);
        }
        if (it.snippet) snippet(toTemplate(text))(view, completion, start, end);
        else view.dispatch({ changes: { from: start, to: end, insert: text }, selection: { anchor: start + text.length }, userEvent: "input.complete" });
        if (it.additionalTextEdits?.length) {
          view.dispatch({ changes: it.additionalTextEdits.map((e) => ({ from: offsetOf(view, e.range[0], e.range[1]), to: offsetOf(view, e.range[2], e.range[3]), insert: e.newText })) });
        }
      },
    }));
    return { from, options, filter: true };
  };
}

function hover(path: string): Extension {
  return hoverTooltip(async (view, pos) => {
    if (providersFor("hover", path).length === 0 || useExtHost.getState().status !== "ready") return null;
    flushDocs();
    const [line, character] = posOf(view, pos);
    let res: { contents: string[]; range: [number, number, number, number] | null } | null;
    try {
      res = await useExtHost.getState().call("provide.hover", { path, line, character }, 8000);
    } catch {
      return null;
    }
    if (!res || !Array.isArray(res.contents) || res.contents.length === 0) return null;
    const from = res.range ? offsetOf(view, res.range[0], res.range[1]) : pos;
    const to = res.range ? offsetOf(view, res.range[2], res.range[3]) : pos;
    return {
      pos: from,
      end: to,
      above: true,
      create() {
        // Plain text only: extension-provided markdown is never turned into HTML.
        const dom = document.createElement("div");
        dom.style.cssText = "max-width:520px;max-height:260px;overflow:auto;padding:6px 10px;font-size:12.5px;line-height:1.5;white-space:pre-wrap";
        dom.textContent = res!.contents.map((c) => String(c).replace(/```[a-z]*\n?/gi, "")).join("\n\n").slice(0, 6000);
        return { dom };
      },
    };
  });
}

export async function formatView(view: EditorView, path: string): Promise<boolean> {
  if (providersFor("formatting", path).length === 0 || useExtHost.getState().status !== "ready") return false;
  flushDocs();
  const edits = await useExtHost.getState().call<{ range: [number, number, number, number]; newText: string }[] | null>("provide.formatting", { path, tabSize: 4, insertSpaces: true }, 30_000);
  if (!edits) return false;
  const changes = edits
    .map((e) => ({ from: offsetOf(view, e.range[0], e.range[1]), to: offsetOf(view, e.range[2], e.range[3]), insert: e.newText }))
    .sort((a, b) => a.from - b.from)
    .filter((c, i, all) => i === 0 || c.from >= all[i - 1].to);
  if (changes.length > 0) view.dispatch({ changes });
  return true;
}

async function gotoDefinition(view: EditorView, path: string): Promise<boolean> {
  if (providersFor("definition", path).length === 0 || useExtHost.getState().status !== "ready") return false;
  flushDocs();
  const [line, character] = posOf(view, view.state.selection.main.head);
  const res = await useExtHost.getState().call<{ path: string; range: number[] }[]>("provide.definition", { path, line, character }, 10_000);
  const target = Array.isArray(res) ? res[0] : null;
  if (!target) return false;
  await useTabs.getState().goto(target.path, (target.range[0] ?? 0) + 1, (target.range[1] ?? 0) + 1);
  return true;
}

/** All host-driven editor features for one file. */
export function hostEditorExtensions(path: string): Extension[] {
  return [
    EditorState.languageData.of(() => [{ autocomplete: completionSource(path) }]),
    hover(path),
    keymap.of([
      { key: "Shift-Alt-f", run: (v) => { void formatView(v, path); return true; } },
      { key: "F12", run: (v) => { void gotoDefinition(v, path); return true; } },
    ]),
  ];
}

const SEVERITY: Diagnostic["severity"][] = ["error", "warning", "info", "info"];

/** Pushes the extension diagnostics for `path` into the editor. */
export function pushDiagnostics(view: EditorView, path: string) {
  const all = useExtHost.getState().diagnostics;
  const list: Diagnostic[] = [];
  for (const [key, diags] of Object.entries(all)) {
    if (!key.endsWith("\u0000" + path)) continue;
    for (const d of diags as Diag[]) {
      const from = offsetOf(view, d.range[0], d.range[1]);
      let to = offsetOf(view, d.range[2], d.range[3]);
      if (to <= from) to = Math.min(view.state.doc.length, from + 1);
      list.push({ from, to, severity: SEVERITY[d.severity] ?? "info", message: d.message, source: d.source });
    }
  }
  view.dispatch(setDiagnostics(view.state, list));
}
