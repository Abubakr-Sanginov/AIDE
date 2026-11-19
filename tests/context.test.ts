import { test } from "node:test";
import assert from "node:assert/strict";
import { historyFor } from "../src/lib/chatHistoryWindow.ts";
import { parsePlan } from "../src/lib/plan.ts";
import { estimateTokens, windowFromModel } from "../src/lib/contextSize.ts";

const msg = (id: string, extra: Record<string, unknown> = {}) => ({ id, content: id, ...extra }) as { id: string; summary?: boolean };

test("without a summary the whole history goes to the model", () => {
  const messages = [msg("a"), msg("b"), msg("c")];
  assert.deepEqual(historyFor(messages).map((m) => m.id), ["a", "b", "c"]);
});

test("after compacting only the summary and what follows it go to the model", () => {
  const messages = [msg("a"), msg("b"), msg("summary", { summary: true }), msg("c")];
  assert.deepEqual(historyFor(messages).map((m) => m.id), ["summary", "c"]);
});

test("the last summary wins when a chat was compacted twice", () => {
  const messages = [
    msg("a"),
    msg("s1", { summary: true }),
    msg("b"),
    msg("s2", { summary: true }),
    msg("c"),
  ];
  assert.deepEqual(historyFor(messages).map((m) => m.id), ["s2", "c"]);
});

test("an empty chat stays empty", () => {
  assert.deepEqual(historyFor([]), []);
});

test("a plan is read from a numbered list", () => {
  const steps = parsePlan("Вот план:\n1. Прочитать routes.tsx\n2. Создать экран\n3) Добавить ссылку");
  assert.deepEqual(
    steps.map((s) => s.text),
    ["Прочитать routes.tsx", "Создать экран", "Добавить ссылку"],
  );
  assert.ok(steps.every((s) => !s.done));
});

test("bullets and checkboxes are understood", () => {
  const steps = parsePlan("- Пункт один\n* [x] Пункт два\n+ [ ] Пункт три");
  assert.deepEqual(steps, [
    { text: "Пункт один", done: false },
    { text: "Пункт два", done: true },
    { text: "Пункт три", done: false },
  ]);
});

test("prose and code ticks are not mistaken for steps", () => {
  const steps = parsePlan("Сделаю это в два шага: сначала прочитаю код.\n\n```ts\nconst a = 1;\n```\n- единственный шаг");
  assert.deepEqual(steps, [{ text: "единственный шаг", done: false }]);
});

test("a step keeps its text but loses the markdown noise", () => {
  const steps = parsePlan("1. **Важно:** вызвать `apply_edit` на файле");
  assert.equal(steps[0].text, "Важно: вызвать apply_edit на файле");
});

test("an empty answer has no plan", () => {
  assert.deepEqual(parsePlan(""), []);
  assert.deepEqual(parsePlan("Готово, всё сделал."), []);
});

test("Cyrillic text costs more tokens than the same amount of Latin", () => {
  const cyr = estimateTokens("привет мир как дела");
  const lat = estimateTokens("hello world how are you");
  assert.ok(cyr > lat, `cyrillic ${cyr} should cost more than latin ${lat}`);
  assert.equal(estimateTokens(""), 0);
});

test("a token estimate grows with the text", () => {
  const one = estimateTokens("функция");
  const many = estimateTokens("функция ".repeat(10));
  assert.ok(many > one * 8);
});

test("the window is read from the model name when it is there", () => {
  assert.equal(windowFromModel("gpt-4o-128k"), 128_000);
  assert.equal(windowFromModel("something-32k-preview"), 32_000);
  assert.equal(windowFromModel("model-1m"), 1_000_000);
  assert.equal(windowFromModel("claude-sonnet-4-5"), null);
  assert.equal(windowFromModel(""), null);
});

test("a digit glued to a word is not a window size", () => {
  assert.equal(windowFromModel("gpt3k-ultra"), null);
});
