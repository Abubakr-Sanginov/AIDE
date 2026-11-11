import { test } from "node:test";
import assert from "node:assert/strict";
import { adoptLegacy, hashRoot, keyFor, normRoot, sameRoot } from "../src/lib/workspaceKey.ts";

function stubStorage(initial: Record<string, string>) {
  const data = new Map(Object.entries(initial));
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
  };
  return data;
}

test("an old unscoped value moves to the first project only", () => {
  const data = stubStorage({ "aide.design.chats": "[1]" });
  const a = adoptLegacy("aide.design.chats", "D:\\Projects\\A");
  assert.equal(data.get(a), "[1]");
  assert.equal(data.has("aide.design.chats"), false);
  const b = adoptLegacy("aide.design.chats", "D:\\Projects\\B");
  assert.notEqual(a, b);
  assert.equal(data.has(b), false);
});

test("an existing project value is never overwritten by the old one", () => {
  const key = keyFor("aide.kins.tasks", "D:\\Projects\\A");
  const data = stubStorage({ "aide.kins.tasks": "old", [key]: "mine" });
  assert.equal(adoptLegacy("aide.kins.tasks", "d:/projects/a/"), key);
  assert.equal(data.get(key), "mine");
});

test("one project written differently still gets one key", () => {
  const a = keyFor("aide.chatHistory", "D:\\Projects\\AIDE");
  assert.equal(keyFor("aide.chatHistory", "d:/projects/aide/"), a);
  assert.equal(keyFor("aide.chatHistory", "D:/Projects/AIDE"), a);
  assert.equal(keyFor("aide.chatHistory", "D:\\Projects\\AIDE\\\\"), a);
});

test("different projects never share a key", () => {
  const roots = ["D:\\Projects\\AIDE", "D:\\Projects\\shop", "D:\\Projects\\aide-old", "E:\\Projects\\AIDE"];
  const keys = roots.map((r) => keyFor("aide.chatHistory", r));
  assert.equal(new Set(keys).size, keys.length);
});

test("a chat without a project keeps the base key", () => {
  assert.equal(keyFor("aide.chatHistory", null), "aide.chatHistory");
  assert.equal(keyFor("aide.chatHistory", ""), "aide.chatHistory");
  assert.equal(keyFor("aide.chatHistory", "   "), "aide.chatHistory");
  assert.equal(normRoot(null), "");
  assert.equal(hashRoot(undefined), "");
});

test("keys stay inside the characters the backend accepts", () => {
  for (const root of ["D:\\Проекты\\AIDE", "/home/u/проект", "\\\\server\\share\\x", "D:\\a b\\c"]) {
    assert.match(keyFor("aide.chats", root), /^aide\.chats\.[0-9a-f]{8}$/);
  }
});

test("roots compare by their normalized value", () => {
  assert.equal(sameRoot("D:\\Projects\\AIDE\\", "d:/projects/aide"), true);
  assert.equal(sameRoot("D:\\Projects\\AIDE", "D:\\Projects\\shop"), false);
  assert.equal(sameRoot(null, null), true);
  assert.equal(sameRoot(null, "D:\\Projects"), false);
});
