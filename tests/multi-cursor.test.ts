import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import {
  addCursorAbove,
  addCursorBelow,
  selectAllOccurrences,
  selectNextOccurrence,
} from "../src/lib/multiCursor.ts";

const make = (doc: string, sel: EditorSelection | { anchor: number; head?: number }) =>
  EditorState.create({ doc, selection: sel, extensions: EditorState.allowMultipleSelections.of(true) });

const apply = (s: EditorState, spec: TransactionSpec | null) => {
  assert.ok(spec, "expected a transaction");
  return s.update(spec).state;
};

const ranges = (s: EditorState) => s.selection.ranges.map((r) => [r.from, r.to]);

test("addCursorBelow adds a cursor on the next line and typing goes to both", () => {
  let s = make("abc\ndef", { anchor: 1 });
  s = apply(s, addCursorBelow(s));
  assert.deepEqual(ranges(s), [[1, 1], [5, 5]]);
  s = s.update(s.replaceSelection("X")).state;
  assert.equal(s.doc.toString(), "aXbc\ndXef");
});

test("addCursorBelow keeps the column clamped to a shorter line; nothing below the last line", () => {
  let s = make("abcdef\nxy", { anchor: 5 });
  s = apply(s, addCursorBelow(s));
  assert.deepEqual(ranges(s), [[5, 5], [9, 9]]);
  assert.equal(addCursorBelow(make("one", { anchor: 1 })), null);
});

test("addCursorAbove mirrors addCursorBelow", () => {
  let s = make("abc\ndef", { anchor: 6 });
  s = apply(s, addCursorAbove(s));
  assert.deepEqual(ranges(s), [[2, 2], [6, 6]]);
  assert.equal(addCursorAbove(make("abc", { anchor: 0 })), null);
});

test("selectNextOccurrence: word first, then the next occurrence, wrapping around", () => {
  let s = make("foo bar foo foo", { anchor: 9 });
  s = apply(s, selectNextOccurrence(s));
  assert.deepEqual(ranges(s), [[8, 11]]);
  s = apply(s, selectNextOccurrence(s));
  assert.deepEqual(ranges(s), [[8, 11], [12, 15]]);
  s = apply(s, selectNextOccurrence(s));
  assert.deepEqual(ranges(s), [[0, 3], [8, 11], [12, 15]]);
  assert.equal(selectNextOccurrence(s), null, "all taken");
});

test("selectAllOccurrences selects every match", () => {
  const s = make("a.b a.b x a.b", { anchor: 0, head: 3 });
  const next = apply(s, selectAllOccurrences(s));
  assert.deepEqual(ranges(next), [[0, 3], [4, 7], [10, 13]]);
  assert.equal(selectAllOccurrences(make("   ", { anchor: 1 })), null);
});
