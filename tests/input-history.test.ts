import { test } from "node:test";
import assert from "node:assert/strict";
import { appendHist, nextIndex, prevIndex, MAX_HIST } from "../src/lib/inputHistory.ts";

test("empty history never navigates", () => {
  assert.equal(prevIndex([], null), null);
  assert.equal(nextIndex([], null), null);
  assert.equal(nextIndex([], 0), null);
});

test("ArrowUp starts from the newest message and walks older", () => {
  const h = ["first", "second", "third"];
  assert.equal(prevIndex(h, null), 2);
  assert.equal(prevIndex(h, 2), 1);
  assert.equal(prevIndex(h, 1), 0);
  // clamped at the oldest, never wraps
  assert.equal(prevIndex(h, 0), 0);
});

test("ArrowDown walks newer and exits past the newest", () => {
  const h = ["first", "second", "third"];
  assert.equal(nextIndex(h, 0), 1);
  assert.equal(nextIndex(h, 1), 2);
  assert.equal(nextIndex(h, 2), null);
});

test("appendHist bounds the list and ignores blank sends", () => {
  assert.deepEqual(appendHist([], "   "), []);
  let h: string[] = [];
  for (let i = 0; i < MAX_HIST + 10; i++) h = appendHist(h, "m" + i);
  assert.equal(h.length, MAX_HIST);
  assert.equal(h[0], "m10");
  assert.equal(h[h.length - 1], "m" + (MAX_HIST + 9));
});
