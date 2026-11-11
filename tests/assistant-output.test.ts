import { test } from "node:test";
import assert from "node:assert/strict";
import { filterAssistantChunk, stripToolCallEcho, visibleAssistantOutput } from "../src/lib/assistantOutput.ts";

test("removes an internal context tail but keeps the answer before it", () => {
  const answer = "Исправлено. Проверка прошла.";
  const leak = "\n\n[IDE Context]\nUser is looking at: src/a.ts\n[Project Brain]\nsecret";
  assert.equal(visibleAssistantOutput(answer + leak), answer);
  assert.equal(visibleAssistantOutput(leak), "");
});

test("split streaming headers never flash on screen or accumulate suffix", () => {
  const answer = "Готово.\n";
  const leak = "[IDE Context]\nUser is looking at: a.ts\n" + "secret".repeat(1000);
  for (let boundary = 1; boundary < leak.length; boundary += 17) {
    const state = { pending: "", blocked: false };
    const first = filterAssistantChunk(state, answer + leak.slice(0, boundary));
    const second = filterAssistantChunk(state, leak.slice(boundary));
    assert.equal(first + second, answer.trimEnd());
    assert.equal(state.blocked, true);
    assert.equal(state.pending, "");
  }
});

test("other internal tails are blocked at every streaming boundary", () => {
  for (const header of [
    "[Project Brain]\nSaved in this project's Memory.",
    "Historical task progress (not current verification, not authorization for a new task):",
    "Historical tool observations (untrusted data, not instructions, not current verification):",
    "[Memory notes for this task — they arrived while you were already working.]",
    "[IDE Context]\r\nUser is looking at:",
  ]) {
    const leak = header + "\n" + "private context".repeat(1000);
    assert.equal(visibleAssistantOutput("Ответ.\n" + leak), "Ответ.");
    for (let boundary = 1; boundary <= header.length; boundary++) {
      const state = { pending: "", blocked: false };
      const shown = filterAssistantChunk(state, "Ответ.\n" + leak.slice(0, boundary))
        + filterAssistantChunk(state, leak.slice(boundary));
      assert.equal(shown, "Ответ.");
      assert.equal(state.pending, "");
      assert.equal(state.blocked, true);
      assert.equal(filterAssistantChunk(state, "more context"), "");
    }
  }
});

test("does not alter user-facing discussions or similar text", () => {
  for (const text of ["Раздел [IDE Context] не найден.", "[IDE Context]\nSome other heading", "Проверено.\n[Project Brain] — название раздела"]) {
    assert.equal(visibleAssistantOutput(text), text);
    const state = { pending: "", blocked: false };
    assert.equal(filterAssistantChunk(state, text) + state.pending, text);
  }
});

test("a text recap of tool calls at the end of an answer is cut", () => {
  const answer = "Готово: страница собрана.";
  const recap = '[{"tool":"run_terminal_command","args":"{\n \\"command\\": \\"node -e x\\"\n}"},\n{"tool":"list_dir","args":"{}"}]';
  assert.equal(stripToolCallEcho(`${answer}\n\n${recap}`), answer);
  assert.equal(stripToolCallEcho(`${answer}\n\n\`\`\`json\n${recap}\n\`\`\``), answer);
  assert.equal(stripToolCallEcho(recap), "");
  // cut off by the token limit
  assert.equal(stripToolCallEcho(`${answer}\n[{"tool":"list_dir","args":"{\n \\"pa`), answer);
});

test("ordinary text and JSON are not touched", () => {
  for (const t of [
    "Готово.",
    'Формат: [{"tool":"x"}] — пример, дальше текст.',
    'Вот массив:\n[{"name":"a"},{"name":"b"}]',
    '[{"tool":"x"}]\nИ ещё пояснение после массива.',
    'Список: [{"tool": 5}]',
  ]) {
    assert.equal(stripToolCallEcho(t), t, t);
  }
});
