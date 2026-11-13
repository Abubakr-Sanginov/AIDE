import { test } from "node:test";
import assert from "node:assert/strict";
import { lastMessages, queryWords, searchSessions, snippet, type SessionLike } from "../src/lib/sessionsSearch.ts";
import { MAX_TASKS_PER_SESSION, addTask, findTask, openCount, parseTasks, pruneTasks, removeTask, setDone } from "../src/lib/sessionTasks.ts";

const s = (id: string, title: string, updatedAt: number, ...msgs: [string, string][]): SessionLike => ({
  id, title, updatedAt, messages: msgs.map(([role, content]) => ({ role, content })),
});

const sessions = [
  s("a", "Сайт пиццерии", 100, ["user", "Сделай сайт пиццерии с меню"], ["assistant", "Готово: меню и карточки пицц"]),
  s("b", "Баг в терминале", 300, ["user", "Терминал падает при запуске"], ["assistant", "Исправил запуск терминала в terminal.rs"]),
  s("c", "Разное", 200, ["user", "Привет"]),
];

test("query words", () => {
  assert.deepEqual(queryWords("Терминал, ПАДАЕТ! и  терминал"), ["терминал", "падает"]);
  assert.deepEqual(queryWords("a б"), []);
  assert.ok(queryWords("w1 w2 w3 w4 w5 w6 w7 w8 w9 w10").length <= 8);
});

test("snippets cut around the hit", () => {
  const text = "x".repeat(300) + " нашлось слово здесь " + "y".repeat(300);
  const sn = snippet(text, ["слово"], 30);
  assert.ok(sn.startsWith("…") && sn.endsWith("…") && sn.includes("слово") && sn.length < 100);
  assert.equal(snippet("коротко", ["нет"]), "коротко");
});

test("search ranks by words, title counts double, newest wins ties", () => {
  const hits = searchSessions(sessions, "терминал");
  assert.deepEqual(hits.map((h) => h.id), ["b"]);
  assert.ok(hits[0].snippets.length > 0 && hits[0].snippets[0].includes("ерминал"));
  assert.deepEqual(searchSessions(sessions, "сайт меню").map((h) => h.id), ["a"]);
  assert.deepEqual(searchSessions(sessions, "ничегонет"), []);
  assert.deepEqual(searchSessions(sessions, "  "), []);
  // two sessions match: the one with more matching words first
  const two = [s("x", "t", 1, ["user", "alpha"]), s("y", "t", 2, ["user", "alpha beta"])];
  assert.deepEqual(searchSessions(two, "alpha beta").map((h) => h.id), ["y", "x"]);
  assert.equal(searchSessions(sessions, "привет сайт терминал", 2).length, 2);
});

test("reading the last messages", () => {
  const long = s("l", "t", 1, ...Array.from({ length: 30 }, (_, i) => ["user", `сообщение ${i}`] as [string, string]));
  assert.equal(lastMessages(long, 5).length, 5);
  assert.ok(lastMessages(long, 5)[4].includes("29"));
  assert.equal(lastMessages(long, 999).length, 20);
  assert.equal(lastMessages(long, 0).length, 10);
  assert.ok(lastMessages(s("m", "t", 1, ["assistant", "я".repeat(2000)]), 1, 100)[0].length < 130);
  assert.deepEqual(lastMessages(s("e", "t", 1, ["user", "   "]), 3), []);
});

test("tasks: add, finish, remove, limits", () => {
  let map = {};
  const r1 = addTask(map, "chat1", "  Починить   терминал ", "self", 1000, "t1");
  assert.ok(!("error" in r1));
  map = (r1 as { map: typeof map }).map;
  assert.equal(map["chat1"][0].text, "Починить терминал");
  assert.ok("error" in addTask(map, "chat1", "Починить терминал", "self"), "duplicates are refused");
  assert.ok("error" in addTask(map, "chat1", "   ", "self"));
  // a task handed to another session remembers who gave it
  const r2 = addTask(map, "chat2", "Проверить сайт", "chat1", 2000, "t2") as { map: typeof map };
  map = r2.map;
  assert.equal(map["chat2"][0].from, "chat1");
  assert.equal(openCount(map, "chat1"), 1);
  assert.equal(findTask(map, "t2")?.chatId, "chat2");
  map = setDone(map, "t1", true)!;
  assert.equal(openCount(map, "chat1"), 0);
  assert.equal(setDone(map, "nope", true), null);
  map = removeTask(map, "t2")!;
  assert.equal(map["chat2"], undefined);
  assert.equal(removeTask(map, "t2"), null);
  // too many open tasks
  let full = {};
  for (let i = 0; i < MAX_TASKS_PER_SESSION; i++) full = (addTask(full, "c", `задание ${i}`, "self", 1, `i${i}`) as { map: typeof full }).map;
  assert.ok("error" in addTask(full, "c", "ещё одно", "self"));
  // long text is cut
  assert.equal((addTask({}, "c", "я".repeat(1000), "self", 1, "z") as { task: { text: string } }).task.text.length, 300);
});

test("saved tasks: bad data is dropped, old sessions are forgotten", () => {
  assert.deepEqual(parseTasks(null), {});
  assert.deepEqual(parseTasks("{broken"), {});
  assert.deepEqual(parseTasks("[1]"), {});
  const map = parseTasks(JSON.stringify({ a: [{ id: "1", text: "ok", done: true, from: "self", createdAt: 5 }, { id: 2, text: "bad" }, null, { id: "3", text: "  " }], b: "nope" }));
  assert.deepEqual(Object.keys(map), ["a"]);
  assert.equal(map["a"].length, 1);
  assert.equal(map["a"][0].done, true);
  assert.deepEqual(pruneTasks(map, new Set(["zzz"])), {});
  assert.deepEqual(Object.keys(pruneTasks(map, new Set(["a"]))), ["a"]);
});
