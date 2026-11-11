import { test } from "node:test";
import assert from "node:assert/strict";
import { groupFiles, isStaged, isUnstaged, pathsFor, statusLetter } from "../src/features/git/model.ts";

const f = (path: string, index: string, worktree: string, orig_path: string | null = null) => ({ path, index, worktree, orig_path });

test("'M'/'M' file is shown in both Staged and Changes", () => {
  const g = groupFiles([f("both.ts", "M", "M")]);
  assert.deepEqual(g.staged.map((x) => x.path), ["both.ts"]);
  assert.deepEqual(g.changes.map((x) => x.path), ["both.ts"]);
  assert.equal(statusLetter(g.staged[0], true), "M");
  assert.equal(statusLetter(g.changes[0], false), "M");
});

test("staged-only, worktree-only and untracked files go to one group", () => {
  const g = groupFiles([f("s.ts", "A", " "), f("w.ts", " ", "D"), f("n.ts", "?", "?")]);
  assert.deepEqual(g.staged.map((x) => x.path), ["s.ts"]);
  assert.deepEqual(g.changes.map((x) => x.path), ["n.ts", "w.ts"]);
  assert.deepEqual(g.conflicts, []);
});

test("after staging and committing, the file leaves every group", () => {
  // Stage: " M" -> "M "; commit: the entry disappears from porcelain output.
  const before = f("a.ts", " ", "M");
  assert.equal(isUnstaged(before), true);
  const staged = f("a.ts", "M", " ");
  assert.equal(isStaged(staged) && !isUnstaged(staged), true);
  const g = groupFiles([]);
  assert.equal(g.staged.length + g.changes.length + g.conflicts.length, 0);
});

test("conflicts are kept out of Staged and Changes", () => {
  const g = groupFiles([f("c.ts", "U", "U"), f("d.ts", "A", "A")]);
  assert.deepEqual(g.conflicts.map((x) => x.path), ["c.ts", "d.ts"]);
  assert.equal(g.staged.length + g.changes.length, 0);
  assert.deepEqual(pathsFor(f("c.ts", "U", "U"), false), ["c.ts"]);
});
