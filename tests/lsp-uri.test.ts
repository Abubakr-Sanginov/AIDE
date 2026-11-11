import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeUri } from "../src/features/lsp/uri.ts";

test("the same Windows file matches across server encodings", () => {
  const a = normalizeUri("file:///D:/Projects/AIDE/src/App.tsx");
  assert.equal(normalizeUri("file:///d%3A/Projects/AIDE/src/App.tsx"), a);
  assert.equal(normalizeUri("file:///D:\\Projects\\AIDE\\src\\App.tsx"), a);
  assert.equal(normalizeUri("file://D:/Projects/AIDE/src/App.tsx"), a);
});

test("different files stay different", () => {
  assert.notEqual(normalizeUri("file:///D:/a/b.ts"), normalizeUri("file:///D:/a/c.ts"));
});

test("spaces and malformed escapes do not throw", () => {
  assert.equal(normalizeUri("file:///D:/My%20Project/a.ts"), "file:///d:/my project/a.ts");
  assert.doesNotThrow(() => normalizeUri("file:///D:/100%/a.ts"));
});
