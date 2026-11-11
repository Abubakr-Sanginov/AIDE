import { test } from "node:test";
import assert from "node:assert/strict";
import { addQueued, prioritizeQueued, removeQueued, nextQueued, type QueuedItem } from "../src/lib/queue.ts";

test("queued messages accumulate instead of overwriting each other", () => {
  let q: QueuedItem[] = [];
  q = addQueued(q, "первое");
  q = addQueued(q, "второе");
  assert.equal(q.length, 2);
  assert.deepEqual(q.map((x) => x.text), ["первое", "второе"]);
});

test("blank messages are ignored", () => {
  assert.deepEqual(addQueued([], "   "), []);
  assert.deepEqual(addQueued([], ""), []);
});

test("remove and take-first keep order", () => {
  const a = addQueued(addQueued([], "a"), "b");
  const rest = removeQueued(a, a[0].id);
  assert.deepEqual(rest.map((x) => x.text), ["b"]);
  const nxt = nextQueued(a);
  assert.equal(nxt?.first.text, "a");
  assert.deepEqual(nxt?.rest.map((x) => x.text), ["b"]);
  assert.equal(nextQueued([]), null);
});

test("prioritize keeps order and moves the chosen message first", () => {
  const q: QueuedItem[] = [
    { id: "a", text: "first" },
    { id: "b", text: "second" },
    { id: "c", text: "third" },
  ];
  const out = prioritizeQueued(q, "c");
  assert.equal(out[0].id, "c");
  assert.equal(out.map((x) => x.id).join(), "c,a,b");
  // unknown id is a no-op
  assert.equal(prioritizeQueued(q, "zz").length, 3);
});
