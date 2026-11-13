// Selection in the file tree, with the same rules as Windows Explorer and VS Code:
// click selects one, Ctrl+click toggles, Shift+click selects a range, Ctrl+A selects everything visible,
// arrows move (Shift extends), Delete sends to the Recycle Bin, Shift+Delete deletes for good.

export interface TreeEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export interface Row {
  entry: TreeEntry;
  depth: number;
}

/** Rows in the order the tree shows them: folders open in place, closed folders hide their children. */
export function visibleRows(
  root: string,
  cache: Record<string, TreeEntry[]>,
  expanded: Record<string, boolean>,
): Row[] {
  const out: Row[] = [];
  const walk = (dir: string, depth: number, seen: Set<string>) => {
    if (seen.has(dir)) return; // a symlink loop must not hang the UI
    const next = new Set(seen).add(dir);
    for (const entry of cache[dir] ?? []) {
      out.push({ entry, depth });
      if (entry.is_dir && expanded[entry.path]) walk(entry.path, depth + 1, next);
    }
  };
  walk(root, 0, new Set());
  return out;
}

export interface Selection {
  selected: string[];
  /** Where a Shift range starts: the last item chosen without Shift. */
  anchor: string | null;
  /** The item the keyboard moves from. */
  focus: string | null;
}

export const EMPTY_SELECTION: Selection = { selected: [], anchor: null, focus: null };

function range(order: string[], a: string, b: string): string[] {
  const i = order.indexOf(a);
  const j = order.indexOf(b);
  if (i < 0 || j < 0) return [b];
  return order.slice(Math.min(i, j), Math.max(i, j) + 1);
}

/** A mouse click on `path` with the modifier keys that were held. */
export function clickSelect(sel: Selection, order: string[], path: string, mods: { ctrl: boolean; shift: boolean }): Selection {
  if (mods.shift && sel.anchor && order.includes(sel.anchor)) {
    const picked = range(order, sel.anchor, path);
    // Ctrl+Shift adds the range to what is already selected, plain Shift replaces it.
    const selected = mods.ctrl ? [...new Set([...sel.selected, ...picked])] : picked;
    return { selected, anchor: sel.anchor, focus: path };
  }
  if (mods.ctrl) {
    const has = sel.selected.includes(path);
    const selected = has ? sel.selected.filter((p) => p !== path) : [...sel.selected, path];
    return { selected, anchor: path, focus: path };
  }
  return { selected: [path], anchor: path, focus: path };
}

/** An arrow key (or Home/End): moves the focus; with Shift it extends the selection from the anchor. */
export function moveSelect(sel: Selection, order: string[], key: "up" | "down" | "home" | "end", shift: boolean): Selection {
  if (order.length === 0) return sel;
  const cur = sel.focus ? order.indexOf(sel.focus) : -1;
  let idx: number;
  if (key === "home") idx = 0;
  else if (key === "end") idx = order.length - 1;
  else if (cur < 0) idx = key === "down" ? 0 : order.length - 1;
  else idx = Math.min(order.length - 1, Math.max(0, cur + (key === "down" ? 1 : -1)));
  const focus = order[idx];
  if (shift) {
    const anchor = sel.anchor && order.includes(sel.anchor) ? sel.anchor : focus;
    return { selected: range(order, anchor, focus), anchor, focus };
  }
  return { selected: [focus], anchor: focus, focus };
}

export function selectAll(order: string[]): Selection {
  return { selected: [...order], anchor: order[0] ?? null, focus: order[order.length - 1] ?? null };
}

/** Is `path` the same as `dir` or inside it (Windows or Unix separators)? */
export function isSameOrInside(path: string, dir: string): boolean {
  const norm = (p: string) => p.replace(/[\\/]+/g, "/").replace(/\/$/, "").toLowerCase();
  const a = norm(path);
  const d = norm(dir);
  return a === d || a.startsWith(d + "/");
}

/** Drops items that sit inside another selected folder: deleting the folder already deletes them. */
export function withoutNested(paths: string[]): string[] {
  return paths.filter((p) => !paths.some((q) => q !== p && isSameOrInside(p, q) && !isSameOrInside(q, p)));
}

/** After a delete: keep the keyboard where the user was, on the nearest surviving row. */
export function focusAfterDelete(order: string[], removed: string[]): string | null {
  const gone = (p: string) => removed.some((r) => isSameOrInside(p, r));
  const first = order.findIndex(gone);
  if (first < 0) return null;
  for (let i = first; i < order.length; i++) if (!gone(order[i])) return order[i];
  for (let i = first - 1; i >= 0; i--) if (!gone(order[i])) return order[i];
  return null;
}
