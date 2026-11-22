import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ITEMS,
  MAX_ITEM_CHARS,
  MAX_TOTAL_CHARS,
  appendItems,
  dataUri,
  isLocalResourceUrl,
  isSafeImage,
  makeItem,
  stepIndex,
} from "../src/lib/studioPreview.ts";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

test("only raster images with a plain base64 body are accepted", () => {
  assert.ok(isSafeImage({ mime: "image/png", data: PNG }));
  assert.ok(!isSafeImage({ mime: "image/svg+xml", data: PNG }));
  assert.ok(!isSafeImage({ mime: "text/html", data: PNG }));
  assert.ok(!isSafeImage({ mime: "image/png", data: PNG + '"onerror="alert(1)' }));
  assert.ok(!isSafeImage({ mime: "image/png", data: "" }));
  assert.ok(!isSafeImage({ mime: "image/png", data: "A".repeat(MAX_ITEM_CHARS + 1) }));
  assert.equal(makeItem({ mime: "image/svg+xml", data: PNG }, "t"), null);
  assert.equal(dataUri({ mime: "image/png", data: PNG }), `data:image/png;base64,${PNG}`);
});

test("history is bounded by count and by memory, newest kept", () => {
  const mk = (n: number, size = 10) => makeItem({ mime: "image/png", data: "A".repeat(size) }, `t${n}`, n)!;
  let list = [] as ReturnType<typeof mk>[];
  for (let i = 0; i < MAX_ITEMS + 10; i++) list = appendItems(list, [mk(i)]);
  assert.equal(list.length, MAX_ITEMS);
  assert.equal(list[list.length - 1].tool, `t${MAX_ITEMS + 9}`);
  let heavy = [] as typeof list;
  for (let i = 0; i < 12; i++) heavy = appendItems(heavy, [mk(i, 5_000_000)]);
  assert.ok(heavy.length < 12);
  assert.ok(heavy.reduce((n, i) => n + i.data.length, 0) <= MAX_TOTAL_CHARS);
  assert.equal(heavy[heavy.length - 1].tool, "t11");
});

test("the model viewer reads only embedded resources, never addresses", () => {
  assert.ok(isLocalResourceUrl("data:image/png;base64,AAAA"));
  assert.ok(isLocalResourceUrl("blob:http://localhost/abc"));
  for (const bad of ["https://evil.example/x.png", "http://169.254.169.254/", "file:///C:/secret", "//evil/x", "textures/a.png", "javascript:alert(1)"]) {
    assert.ok(!isLocalResourceUrl(bad), bad);
  }
});

test("stepping stops at both ends", () => {
  assert.equal(stepIndex(0, -1, 5), 0);
  assert.equal(stepIndex(4, 1, 5), 4);
  assert.equal(stepIndex(2, 1, 5), 3);
  assert.equal(stepIndex(0, 1, 0), 0);
});
