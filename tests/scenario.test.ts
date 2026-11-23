import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_SCENARIO, cleanScenario, scenarioPrompt } from "../src/lib/scenario.ts";

test("the scenario text is tidied and bounded", () => {
  assert.equal(cleanScenario("  открыть   сайт \n\n  нажать   «Войти»  \n"), "открыть сайт\nнажать «Войти»");
  assert.equal(cleanScenario("   \n \t "), null);
  assert.equal(cleanScenario(""), null);
  assert.equal(cleanScenario("я".repeat(5000))!.length, MAX_SCENARIO);
});

test("agent mode walks the built-in browser, computer mode the real screen", () => {
  const web = scenarioPrompt("залогиниться и открыть профиль", "agent");
  for (const needle of ["залогиниться и открыть профиль", "browser_open", "browser_eval", "browser_screenshot", "browser_console", "browser_responsive_check", "Ничего не исправляй", "Статус"]) {
    assert.ok(web.includes(needle), needle);
  }
  assert.ok(!web.includes("computer_screenshot"));
  const pc = scenarioPrompt("написать боту /start", "computer");
  for (const needle of ["написать боту /start", "computer_screenshot", "computer_focus_window", "ask_user", "Ничего не исправляй", "Статус"]) {
    assert.ok(pc.includes(needle), needle);
  }
  assert.ok(!pc.includes("browser_open"));
  // chat and plan modes cannot drive anything: they get the browser variant text, which they will only describe
  assert.ok(scenarioPrompt("x", "plan").includes("browser_open"));
});
