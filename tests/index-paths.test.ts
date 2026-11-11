import { test } from "node:test";
import assert from "node:assert/strict";
import { absoluteFromIndex, ageLabel, num } from "../src/lib/indexPaths.ts";

test("index paths follow the style of the project root", () => {
  assert.equal(absoluteFromIndex("D:\\Projects\\AIDE", "src/stores/ai.ts"), "D:\\Projects\\AIDE\\src\\stores\\ai.ts");
  assert.equal(absoluteFromIndex("D:\\Projects\\AIDE\\", "a.ts"), "D:\\Projects\\AIDE\\a.ts");
  assert.equal(absoluteFromIndex("/home/me/app/", "src/a.ts"), "/home/me/app/src/a.ts");
  assert.equal(absoluteFromIndex("/home/me/app", "a.ts"), "/home/me/app/a.ts");
});

test("age labels", () => {
  const now = 1_000_000_000;
  assert.equal(ageLabel(0, now, false), "");
  assert.equal(ageLabel(now - 2_000, now, false), "just now");
  assert.equal(ageLabel(now - 30_000, now, true), "30 с назад");
  assert.equal(ageLabel(now - 5 * 60_000, now, false), "5 min ago");
  assert.equal(ageLabel(now - 3 * 3_600_000, now, true), "3 ч назад");
});

test("counters get thousands separators", () => {
  assert.equal(num(12), "12");
  assert.equal(num(12345), "12\u00a0345");
  assert.equal(num(1234567), "1\u00a0234\u00a0567");
});
