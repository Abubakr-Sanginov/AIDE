import { test } from "node:test";
import assert from "node:assert/strict";
import { groupFiles, joinRepoPath, pathsFor, statusLetter } from "../src/features/git/model.ts";

const f = (path: string, index: string, worktree: string, orig_path: string | null = null) => ({ path, index, worktree, orig_path });

test("groups porcelain entries like VS Code", () => {
  const files = [f("b.ts", "M", "M"), f("a.ts", " ", "M"), f("new.ts", "?", "?"), f("c.ts", "U", "U"), f("r.ts", "R", " ", "old.ts")];
  const g = groupFiles(files);
  assert.deepEqual(g.staged.map((x) => x.path), ["b.ts", "r.ts"]);
  assert.deepEqual(g.changes.map((x) => x.path), ["a.ts", "b.ts", "new.ts"]);
  assert.deepEqual(g.conflicts.map((x) => x.path), ["c.ts"]);
});

test("status letters", () => {
  assert.equal(statusLetter(f("x", "?", "?"), false), "U");
  assert.equal(statusLetter(f("x", "A", "M"), true), "A");
  assert.equal(statusLetter(f("x", "A", "M"), false), "M");
  assert.equal(statusLetter(f("x", "U", "U"), false), "!");
});

test("unstaging a rename sends both paths", () => {
  assert.deepEqual(pathsFor(f("new.ts", "R", " ", "old.ts"), true), ["new.ts", "old.ts"]);
  assert.deepEqual(pathsFor(f("new.ts", "R", "M", "old.ts"), false), ["new.ts"]);
});

test("absolute paths keep the root separator (tabs are keyed by path)", () => {
  assert.equal(joinRepoPath("D:\\Projects\\AIDE", "src/app/App.tsx"), "D:\\Projects\\AIDE\\src\\app\\App.tsx");
  assert.equal(joinRepoPath("/home/u/repo/", "a/b.ts"), "/home/u/repo/a/b.ts");
});
