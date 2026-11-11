import { test } from "node:test";
import assert from "node:assert/strict";
import { formatAnswers, isQuestionAnswered, type QuestionInput } from "../src/lib/questionText.ts";

const QS: QuestionInput[] = [
  { question: "О чём сайт?", options: [{ label: "Магазин" }, { label: "Портфолио" }] },
  { question: "Цвета?", multiple: true, options: [{ label: "Тёмная" }, { label: "Светлая" }] },
];

test("answers are formatted as numbered plain text", () => {
  const out = formatAnswers(QS, {
    0: { options: ["Магазин"], custom: "" },
    1: { options: ["Тёмная", "Светлая"], custom: "акцент — зелёный" },
  });
  assert.ok(out.includes("1. О чём сайт?"));
  assert.ok(out.includes("Ответ: Магазин"));
  assert.ok(out.includes("Ответ: Тёмная, Светлая, акцент — зелёный"));
});

test("unanswered questions are marked but still listed", () => {
  const out = formatAnswers(QS, {});
  assert.ok(out.includes("(не выбрано)"));
  assert.equal(isQuestionAnswered(undefined), false);
  assert.equal(isQuestionAnswered({ options: [], custom: "  " }), false);
  assert.equal(isQuestionAnswered({ options: [], custom: "свой" }), true);
});

test("long answers are capped", () => {
  const out = formatAnswers(QS, { 0: { options: [], custom: "x".repeat(20000) } });
  assert.ok(out.length <= 8000);
});
