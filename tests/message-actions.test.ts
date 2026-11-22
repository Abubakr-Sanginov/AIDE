import { test } from "node:test";
import assert from "node:assert/strict";
import { isLastAnswer, questionOf, removeMessage, truncateBefore, type Msg } from "../src/lib/messageActions.ts";

const chat: Msg[] = [
  { id: "u1", role: "user" },
  { id: "a1", role: "assistant" },
  { id: "u2", role: "user" },
  { id: "a2", role: "assistant" },
  { id: "a3", role: "assistant" },
  { id: "u3", role: "user" },
  { id: "a4", role: "assistant" },
];
const ids = (l: Msg[]) => l.map((m) => m.id);

test("editing keeps everything before the question", () => {
  assert.deepEqual(ids(truncateBefore(chat, "u2")), ["u1", "a1"]);
  assert.deepEqual(ids(truncateBefore(chat, "u1")), []);
  assert.deepEqual(ids(truncateBefore(chat, "missing")), ids(chat));
});

test("deleting a question removes its answers, deleting an answer removes only it", () => {
  assert.deepEqual(ids(removeMessage(chat, "u2")), ["u1", "a1", "u3", "a4"]);
  assert.deepEqual(ids(removeMessage(chat, "a2")), ["u1", "a1", "u2", "a3", "u3", "a4"]);
  assert.deepEqual(ids(removeMessage(chat, "u3")), ["u1", "a1", "u2", "a2", "a3"]);
  assert.deepEqual(ids(removeMessage(chat, "nope")), ids(chat));
});

test("an answer knows its question; only the last answer can be redone", () => {
  assert.equal(questionOf(chat, "a3")?.id, "u2");
  assert.equal(questionOf(chat, "a1")?.id, "u1");
  assert.equal(questionOf(chat, "u1"), null);
  assert.equal(isLastAnswer(chat, "a4"), true);
  assert.equal(isLastAnswer(chat, "a3"), false);
  assert.equal(isLastAnswer([{ id: "u", role: "user" }], "u"), false);
});

test("the original list is never changed", () => {
  const before = ids(chat);
  truncateBefore(chat, "u2");
  removeMessage(chat, "u1");
  assert.deepEqual(ids(chat), before);
});
