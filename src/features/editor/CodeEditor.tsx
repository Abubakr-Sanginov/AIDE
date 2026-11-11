import { useEffect, useRef } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import type { Range } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
} from "@codemirror/autocomplete";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
} from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { useTabs, type Tab } from "@/stores/tabs";
import { useInlineEdit } from "@/stores/inlineEdit";
import { languageForPath } from "@/lib/editorLang";
import { useExtensions } from "@/features/extensions/store";
import { extensionsFor } from "@/features/extensions/editorExt";
import { hostEditorExtensions, pushDiagnostics } from "@/features/exthost/cm";
import { useExtHost } from "@/features/exthost/store";
import { registerView, unregisterView } from "@/features/exthost/views";
import { lintGutter } from "@codemirror/lint";
import { editorTheme } from "@/lib/editorTheme";
import { appearanceFor } from "@/lib/editorAppearance";
import { multiCursor } from "@/lib/multiCursor";
import { snippetCompletions } from "@/features/snippets/actions";
import { lspExtensionFor, useLsp } from "@/features/lsp/client";
import {
  InlineEditWidget,
  inlineEditField,
  removedLineMarks,
  setInlineEditDecos,
} from "@/lib/inlineEdit";

// Theme / snippets / grammars from installed VS Code extensions are swapped at runtime.
const appearance = new Compartment();
const extra = new Compartment();
// Language server (completion by types, hover, F12, F2, errors): attached once its server is ready.
const lspConf = new Compartment();

export function CodeEditor({ tab }: { tab: Tab }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const setContent = useTabs((s) => s.setContent);
  const setCursor = useTabs((s) => s.setCursor);
  const pendingInsert = useTabs((s) => s.pendingInsert);
  const inlineEdit = useInlineEdit();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: tab.content,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          foldGutter(),
          drawSelection(),
          dropCursor(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          multiCursor(),
          snippetCompletions(tab.path),
          highlightActiveLine(),
          highlightSelectionMatches(),
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...foldKeymap,
            indentWithTab,
            {
              key: "Mod-k",
              run: (v) => {
                const sel = v.state.selection.main;
                if (sel.empty) return false;
                useInlineEdit.getState().open(
                  tab.id,
                  sel.from,
                  sel.to,
                  v.state.doc.sliceString(sel.from, sel.to),
                );
                return true;
              },
            },
          ]),
          inlineEditField,
          editorTheme,
          appearance.of(appearanceFor()),
          extra.of([]),
          lspConf.of([]),
          lintGutter(),
          languageForPath(tab.path),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              setContent(tab.id, update.state.doc.toString());
              if (useInlineEdit.getState().tabId === tab.id) {
                useInlineEdit.getState().close();
              }
            }
            if (update.docChanged || update.selectionSet) {
              const head = update.state.selection.main.head;
              const line = update.state.doc.lineAt(head);
              setCursor(line.number, head - line.from + 1, update.state.selection.ranges.length);
            }
          }),
        ],
      }),
      parent: container,
    });
    viewRef.current = view;

    // Re-apply extension contributions whenever the installed set or the theme changes.
    let alive = true;
    const applyExtensions = () => {
      view.dispatch({ effects: appearance.reconfigure(appearanceFor()) });
      void extensionsFor(tab.path)
        .then((list) => {
          if (alive) view.dispatch({ effects: extra.reconfigure([...list, ...hostEditorExtensions(tab.path)]) });
        })
        .catch(() => {});
    };
    applyExtensions();
    const applyLsp = () => {
      void lspExtensionFor(tab.path)
        .then((ext) => {
          if (alive) view.dispatch({ effects: lspConf.reconfigure(ext) });
        })
        .catch(() => {});
    };
    applyLsp();
    const unsubscribeLsp = useLsp.subscribe((s, prev) => {
      if (s.enabled === prev.enabled) return;
      if (s.enabled) applyLsp();
      else view.dispatch({ effects: lspConf.reconfigure([]) });
    });
    registerView(tab.path, view);
    pushDiagnostics(view, tab.path);
    const unsubscribeDiag = useExtHost.subscribe((s, prev) => {
      if (s.diagnostics !== prev.diagnostics) pushDiagnostics(view, tab.path);
    });
    let lastRev = useExtensions.getState().rev;
    const unsubscribe = useExtensions.subscribe((s) => {
      if (s.rev !== lastRev) {
        lastRev = s.rev;
        applyExtensions();
      }
    });

    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    setCursor(line.number, head - line.from + 1);

    const onAccept = () => {
      const edit = useInlineEdit.getState();
      if (edit.status !== "done" || edit.tabId !== tab.id) return;
      view.dispatch({
        changes: { from: edit.from, to: edit.to, insert: edit.replacement },
        selection: { anchor: edit.from + edit.replacement.length },
        scrollIntoView: true,
      });
      edit.close();
      view.focus();
    };
    window.addEventListener("aide-inline-accept", onAccept);

    return () => {
      alive = false;
      unsubscribe();
      unsubscribeLsp();
      unsubscribeDiag();
      unregisterView(tab.path, view);
      window.removeEventListener("aide-inline-accept", onAccept);
      if (useInlineEdit.getState().tabId === tab.id) {
        useInlineEdit.getState().close();
      }
      viewRef.current = null;
      view.destroy();
    };
  }, [tab.id]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== tab.content) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: tab.content },
      });
    }
  }, [tab.content]);

  const pendingGoto = useTabs((s) => s.pendingGoto);
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !pendingGoto) return;
    const line = Math.min(pendingGoto.line, view.state.doc.lines);
    const col = Math.min(pendingGoto.col, view.state.doc.line(line).length + 1);
    const pos = view.state.doc.line(line).from + Math.max(0, col - 1);
    view.dispatch({
      selection: { anchor: pos },
      scrollIntoView: true,
    });
    view.focus();
    useTabs.getState().clearGoto();
  }, [pendingGoto, tab.id]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (!inlineEdit.tabId || inlineEdit.tabId !== tab.id) return;
    const decos: Range<Decoration>[] = [];
    if (
      inlineEdit.status !== "input" &&
      inlineEdit.replacement &&
      inlineEdit.original !== inlineEdit.replacement
    ) {
      decos.push(
        ...removedLineMarks(
          view,
          inlineEdit.from,
          inlineEdit.original,
          inlineEdit.replacement,
        ),
      );
    }
    decos.push(
      Decoration.widget({
        widget: new InlineEditWidget(
          inlineEdit.status,
          inlineEdit.replacement,
          inlineEdit.error,
        ),
        side: 1,
      }).range(inlineEdit.to),
    );
    setInlineEditDecos(view, decos);
  }, [inlineEdit, tab.id]);

  useEffect(() => {
    if (!pendingInsert) return;
    const view = viewRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: pendingInsert.text },
      selection: { anchor: sel.from + pendingInsert.text.length },
      scrollIntoView: true,
    });
    view.focus();
    useTabs.getState().clearInsert();
  }, [pendingInsert]);

  return <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden" />;
}