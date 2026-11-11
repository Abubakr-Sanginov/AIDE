import {
  EditorSelection,
  EditorState,
  Prec,
  countColumn,
  findColumn,
  type Extension,
  type SelectionRange,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView, keymap, rectangularSelection, type Command } from "@codemirror/view";
import { SearchCursor } from "@codemirror/search";

// Multi-cursor editing, VS Code style:
//   Alt+Click               add a cursor            Ctrl+D         select next occurrence
//   Ctrl+Alt+Up/Down        add cursor above/below  Ctrl+Shift+L   select all occurrences
//   Shift+Alt+drag          column (box) selection  Shift+Alt+I    cursors at line ends
//   Escape                  back to one cursor (default keymap)
//
// The four pure functions take a state and return a transaction spec (or null when there is
// nothing to do). They only produce multi-range selections when the state allows them
// (`EditorState.allowMultipleSelections`, included in `multiCursorKeymap`).

const MAX_CURSORS = 10000;

const select = (selection: EditorSelection): TransactionSpec => ({
  selection,
  scrollIntoView: true,
  userEvent: "select",
});

function addVertical(state: EditorState, dir: 1 | -1): TransactionSpec | null {
  const { doc, selection } = state;
  const tab = state.tabSize;
  const ranges: SelectionRange[] = [...selection.ranges];
  let main = selection.mainIndex;
  let added = 0;
  selection.ranges.forEach((r, i) => {
    if (ranges.length >= MAX_CURSORS) return;
    const line = doc.lineAt(r.head);
    const n = line.number + dir;
    if (n < 1 || n > doc.lines) return;
    const target = doc.line(n);
    const col = countColumn(line.text, tab, r.head - line.from);
    const pos = target.from + findColumn(target.text, col, tab);
    ranges.push(EditorSelection.cursor(pos));
    // The cursor that was main moves to its new copy, like in VS Code.
    if (i === selection.mainIndex) main = ranges.length - 1;
    added++;
  });
  if (added === 0) return null;
  const next = EditorSelection.create(ranges, main);
  // Cursors already present on the target lines merge: nothing new then.
  return next.ranges.length > selection.ranges.length ? select(next) : null;
}

export const addCursorBelow = (state: EditorState): TransactionSpec | null => addVertical(state, 1);
export const addCursorAbove = (state: EditorState): TransactionSpec | null => addVertical(state, -1);

/** Text to look for: the main selection, or the word under an empty main cursor. */
function needle(state: EditorState): { range: SelectionRange; text: string; fromWord: boolean } | null {
  const main = state.selection.main;
  if (!main.empty) return { range: main, text: state.sliceDoc(main.from, main.to), fromWord: false };
  const word = state.wordAt(main.head);
  if (!word) return null;
  return { range: word, text: state.sliceDoc(word.from, word.to), fromWord: true };
}

function matches(state: EditorState, text: string, from: number, to: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  const cursor = new SearchCursor(state.doc, text, from, to);
  while (!cursor.next().done && out.length < MAX_CURSORS) out.push({ from: cursor.value.from, to: cursor.value.to });
  return out;
}

/** Ctrl+D: the first press selects the word; the next ones add the following occurrences (wraps around). */
export function selectNextOccurrence(state: EditorState): TransactionSpec | null {
  const n = needle(state);
  if (!n) return null;
  const sel = state.selection;
  if (n.fromWord) {
    const ranges = sel.ranges.map((r, i) => (i === sel.mainIndex ? n.range : r));
    return select(EditorSelection.create(ranges, sel.mainIndex));
  }
  if (sel.ranges.length >= MAX_CURSORS) return null;
  const taken = (m: { from: number; to: number }) => sel.ranges.some((r) => r.from === m.from && r.to === m.to);
  const end = n.range.to;
  const after = matches(state, n.text, end, state.doc.length);
  const before = matches(state, n.text, 0, n.range.from);
  const next = [...after, ...before].find((m) => !taken(m));
  if (!next) return null;
  const ranges = [...sel.ranges, EditorSelection.range(next.from, next.to)];
  return select(EditorSelection.create(ranges, ranges.length - 1));
}

/** Ctrl+Shift+L: every occurrence of the selected text (or of the word under the cursor). */
export function selectAllOccurrences(state: EditorState): TransactionSpec | null {
  const n = needle(state);
  if (!n || !n.text) return null;
  const all = matches(state, n.text, 0, state.doc.length);
  if (all.length === 0) return null;
  const ranges = all.map((m) => EditorSelection.range(m.from, m.to));
  const main = Math.max(0, all.findIndex((m) => m.from === n.range.from && m.to === n.range.to));
  return select(EditorSelection.create(ranges, main));
}

const toCommand =
  (fn: (state: EditorState) => TransactionSpec | null): Command =>
  (view) => {
    const spec = fn(view.state);
    if (spec) view.dispatch(spec);
    // Always handled: the default keymaps (search, commands) must not run a second variant.
    return true;
  };

/** Shift+Alt+I: a cursor at the end of every line touched by each selection. */
export const cursorsAtLineEnds: Command = (view) => {
  const { state } = view;
  const ranges: SelectionRange[] = [];
  let changed = false;
  for (const r of state.selection.ranges) {
    if (r.empty) {
      ranges.push(r);
      continue;
    }
    changed = true;
    const first = state.doc.lineAt(r.from).number;
    let last = state.doc.lineAt(r.to).number;
    // A selection that ends at the start of a line does not include that line.
    if (last > first && state.doc.line(last).from === r.to) last--;
    for (let n = first; n <= last && ranges.length < MAX_CURSORS; n++) {
      ranges.push(EditorSelection.cursor(state.doc.line(n).to));
    }
  }
  if (!changed) return false;
  view.dispatch({ selection: EditorSelection.create(ranges), scrollIntoView: true, userEvent: "select" });
  return true;
};

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * Hotkeys (Mod = Ctrl, Cmd on macOS) plus everything multi-cursor needs from the editor:
 * multiple selections and Alt+Click to add a cursor. High precedence beats the default and search keymaps.
 */
export const multiCursorKeymap: Extension = [
  // Without this CodeMirror collapses every multi-range selection to one cursor.
  EditorState.allowMultipleSelections.of(true),
  EditorView.clickAddsSelectionRange.of((e) => e.altKey || (isMac() ? e.metaKey : e.ctrlKey)),
  Prec.high(
    keymap.of([
      { key: "Mod-Alt-ArrowDown", run: toCommand(addCursorBelow), preventDefault: true },
      { key: "Mod-Alt-ArrowUp", run: toCommand(addCursorAbove), preventDefault: true },
      { key: "Mod-d", run: toCommand(selectNextOccurrence), preventDefault: true },
      { key: "Mod-Shift-l", run: toCommand(selectAllOccurrences), preventDefault: true },
    ]),
  ),
];

/** Everything for CodeEditor: hotkeys, Alt+Click, box selection and Shift+Alt+I. */
export function multiCursor(): Extension {
  return [
    multiCursorKeymap,
    // Plain Alt+Click adds a cursor, so the box selection moves to Shift+Alt+drag.
    rectangularSelection({ eventFilter: (e) => e.altKey && e.shiftKey && e.button === 0 }),
    keymap.of([{ key: "Shift-Alt-i", run: cursorsAtLineEnds, preventDefault: true }]),
  ];
}

/** Runs an editor command from the command palette on the active editor. */
export async function runOnActive(cmd: (view: EditorView) => boolean) {
  // Loaded lazily so the pure functions above stay importable without the app stores.
  const [{ useTabs }, { viewFor }] = await Promise.all([import("@/stores/tabs"), import("@/features/exthost/views")]);
  const tabs = useTabs.getState();
  const active = tabs.tabs.find((t) => t.id === tabs.activeId);
  const view = active ? viewFor(active.path) : undefined;
  if (!view) return;
  // The palette is closing and owns the focus right now.
  requestAnimationFrame(() => {
    view.focus();
    cmd(view);
  });
}
