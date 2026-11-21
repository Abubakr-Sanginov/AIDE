import { test } from "node:test";
import assert from "node:assert/strict";
import { latestAgentPlan, parseAgentPlan, planOfTools } from "../src/lib/plan.ts";

const result = "План обновлён: 1/3 выполнено.\n[x] Прочитать Menu.tsx\n[~] Добавить карточки\n[ ] Запустить тесты\nПродолжай по плану; после каждого шага вызывай update_plan с новыми статусами.";

test("the plan written by the agent is read from the tool result", () => {
  const steps = parseAgentPlan(result);
  assert.deepEqual(steps.map((s) => [s.text, s.done, s.active]), [
    ["Прочитать Menu.tsx", true, false],
    ["Добавить карточки", false, true],
    ["Запустить тесты", false, false],
  ]);
  assert.deepEqual(parseAgentPlan("nothing here"), []);
  assert.deepEqual(parseAgentPlan("- [ ] markdown list is not an agent plan"), []);
});

test("the newest successful update_plan wins", () => {
  const tools = [
    { tool: "update_plan", status: "ok", result: "План обновлён: 0/1 выполнено.\n[ ] old" },
    { tool: "read_file", status: "ok", result: "x" },
    { tool: "update_plan", status: "ok", result },
    { tool: "update_plan", status: "error", result: "ОШИБКА: план пуст" },
  ];
  assert.equal(planOfTools(tools)?.length, 3);
  assert.equal(planOfTools([{ tool: "read_file", status: "ok", result: "" }]), null);
  assert.equal(planOfTools(undefined), null);
});

test("the latest plan in a chat and its message", () => {
  const msgs = [
    { tools: [{ tool: "update_plan", status: "ok", result: "План обновлён: 0/1 выполнено.\n[ ] first" }] },
    { tools: [] },
    { tools: [{ tool: "update_plan", status: "ok", result }] },
    {},
  ];
  const r = latestAgentPlan(msgs);
  assert.equal(r?.index, 2);
  assert.equal(r?.steps[1].active, true);
  assert.equal(latestAgentPlan([{}, { tools: [] }]), null);
});
