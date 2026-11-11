import type { EditorView } from "@codemirror/view";
import { useTabs } from "@/stores/tabs";

// Open CodeMirror views by file path, so extension edits land in the live editor.

const views = new Map<string, EditorView>();

export function registerView(path: string, view: EditorView) {
  views.set(path, view);
}
export function unregisterView(path: string, view: EditorView) {
  if (views.get(path) === view) views.delete(path);
}
export function viewFor(path: string): EditorView | undefined {
  return views.get(path);
}

/** VS Code (line, character) → document offset, clamped to the document. */
export function offsetOf(view: EditorView, line: number, ch: number): number {
  const doc = view.state.doc;
  if (line >= doc.lines) return doc.length;
  const l = doc.line(Math.max(0, line) + 1);
  return l.from + Math.min(Math.max(0, ch), l.length);
}

export function applyEditsToOpenView(path: string, edits: { range: [number, number, number, number]; newText: string }[]): boolean {
  const view = views.get(path);
  if (!view) return false;
  const changes = edits
    .map((e) => ({ from: offsetOf(view, e.range[0], e.range[1]), to: offsetOf(view, e.range[2], e.range[3]), insert: e.newText }))
    .sort((a, b) => a.from - b.from);
  // Overlapping edits would throw inside CodeMirror: drop the later ones.
  const safe: typeof changes = [];
  for (const c of changes) if (safe.length === 0 || c.from >= safe[safe.length - 1].to) safe.push(c);
  view.dispatch({ changes: safe });
  return true;
}

export function goToRange(path: string, range: number[]) {
  useTabs.setState({ pendingGoto: { line: (range[0] ?? 0) + 1, col: (range[1] ?? 0) + 1 } });
  void path;
}
