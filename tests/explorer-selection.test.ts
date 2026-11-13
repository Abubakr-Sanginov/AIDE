import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_SELECTION,
  clickSelect,
  focusAfterDelete,
  isSameOrInside,
  moveSelect,
  selectAll,
  visibleRows,
  withoutNested,
  type TreeEntry,
} from "../src/lib/explorerSelection.ts";

const f = (path: string): TreeEntry => ({ name: path.split("\\").pop()!, path, is_dir: false });
const d = (path: string): TreeEntry => ({ name: path.split("\\").pop()!, path, is_dir: true });

const cache = {
  "C:\\p": [d("C:\\p\\src"), f("C:\\p\\a.txt"), f("C:\\p\\b.txt")],
  "C:\\p\\src": [f("C:\\p\\src\\x.ts"), d("C:\\p\\src\\lib")],
  "C:\\p\\src\\lib": [f("C:\\p\\src\\lib\\y.ts")],
};

test("visible rows follow what the tree shows", () => {
  const closed = visibleRows("C:\\p", cache, {});
  assert.deepEqual(closed.map((r) => r.entry.name), ["src", "a.txt", "b.txt"]);
  const open = visibleRows("C:\\p", cache, { "C:\\p\\src": true });
  assert.deepEqual(open.map((r) => r.entry.name), ["src", "x.ts", "lib", "a.txt", "b.txt"]);
  assert.deepEqual(open.map((r) => r.depth), [0, 1, 1, 0, 0]);
  // an expanded folder that is not loaded yet shows nothing under it; a loop cannot hang
  assert.deepEqual(visibleRows("C:\\p", { "C:\\p": [d("C:\\p\\q")] }, { "C:\\p\\q": true }).length, 1);
  const loop = { "C:\\p": [d("C:\\p\\l")], "C:\\p\\l": [d("C:\\p")] };
  assert.ok(visibleRows("C:\\p", loop, { "C:\\p\\l": true, "C:\\p": true }).length < 10);
});

const order = ["1", "2", "3", "4", "5"];

test("click, Ctrl+click and Shift+click", () => {
  let s = clickSelect(EMPTY_SELECTION, order, "2", { ctrl: false, shift: false });
  assert.deepEqual(s.selected, ["2"]);
  s = clickSelect(s, order, "4", { ctrl: true, shift: false });
  assert.deepEqual(s.selected, ["2", "4"]);
  s = clickSelect(s, order, "2", { ctrl: true, shift: false }); // toggles off
  assert.deepEqual(s.selected, ["4"]);
  // Shift: a range from the last plain/ctrl choice (the anchor), in either direction
  s = clickSelect(s, order, "4", { ctrl: false, shift: false });
  s = clickSelect(s, order, "2", { ctrl: false, shift: true });
  assert.deepEqual(s.selected, ["2", "3", "4"]);
  assert.equal(s.anchor, "4");
  s = clickSelect(s, order, "5", { ctrl: false, shift: true });
  assert.deepEqual(s.selected, ["4", "5"]);
  // Ctrl+Shift adds the range to the current selection
  let t = clickSelect(EMPTY_SELECTION, order, "1", { ctrl: false, shift: false });
  t = clickSelect(t, order, "4", { ctrl: true, shift: false });
  t = clickSelect(t, order, "5", { ctrl: true, shift: true });
  assert.deepEqual([...t.selected].sort(), ["1", "4", "5"]);
  // Shift with no anchor behaves like a plain click
  assert.deepEqual(clickSelect(EMPTY_SELECTION, order, "3", { ctrl: false, shift: true }).selected, ["3"]);
});

test("arrow keys move and extend", () => {
  let s = moveSelect(EMPTY_SELECTION, order, "down", false);
  assert.deepEqual(s.selected, ["1"]);
  s = moveSelect(s, order, "down", false);
  assert.deepEqual(s.selected, ["2"]);
  s = moveSelect(s, order, "down", true);
  s = moveSelect(s, order, "down", true);
  assert.deepEqual(s.selected, ["2", "3", "4"]);
  s = moveSelect(s, order, "up", true); // shrinks back toward the anchor
  assert.deepEqual(s.selected, ["2", "3"]);
  assert.equal(moveSelect(moveSelect(EMPTY_SELECTION, order, "up", false), order, "up", false).focus, "4");
  assert.equal(moveSelect(s, order, "end", false).focus, "5");
  assert.equal(moveSelect(s, order, "home", false).focus, "1");
  // never leaves the list
  assert.equal(moveSelect({ selected: ["5"], anchor: "5", focus: "5" }, order, "down", false).focus, "5");
  assert.equal(moveSelect(EMPTY_SELECTION, [], "down", false), EMPTY_SELECTION);
  assert.deepEqual(selectAll(order).selected, order);
});

test("folders and what is inside them", () => {
  assert.equal(isSameOrInside("C:\\p\\src\\x.ts", "C:\\p\\src"), true);
  assert.equal(isSameOrInside("c:/p/SRC", "C:\\p\\src\\"), true);
  assert.equal(isSameOrInside("C:\\p\\srcx", "C:\\p\\src"), false); // a sibling with a longer name
  assert.deepEqual(withoutNested(["C:\\p\\src", "C:\\p\\src\\x.ts", "C:\\p\\a.txt"]), ["C:\\p\\src", "C:\\p\\a.txt"]);
  assert.deepEqual(withoutNested(["C:\\p\\a.txt", "C:\\p\\a.txt"]), ["C:\\p\\a.txt", "C:\\p\\a.txt"]); // exact repeats are the caller's job
});

test("after a delete the focus lands on the nearest row that is left", () => {
  const rows = ["C:\\p\\a", "C:\\p\\b", "C:\\p\\c", "C:\\p\\d"];
  assert.equal(focusAfterDelete(rows, ["C:\\p\\b"]), "C:\\p\\c");
  assert.equal(focusAfterDelete(rows, ["C:\\p\\c", "C:\\p\\d"]), "C:\\p\\b");
  assert.equal(focusAfterDelete(rows, rows), null);
  assert.equal(focusAfterDelete(rows, ["C:\\other"]), null);
});
