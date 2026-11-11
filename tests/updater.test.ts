import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanNotes } from "../src/lib/updater.ts";

test("release notes are shown as short plain text", () => {
  assert.equal(cleanNotes(undefined), "");
  assert.equal(cleanNotes(42), "");
  assert.equal(cleanNotes("  fixed a bug  \n\n"), "fixed a bug");
  assert.equal(cleanNotes("x".repeat(2000)).length, 600);
  // markup stays text: the UI renders it as a string, never as HTML
  assert.equal(cleanNotes("<img src=x onerror=alert(1)>"), "<img src=x onerror=alert(1)>");
});
