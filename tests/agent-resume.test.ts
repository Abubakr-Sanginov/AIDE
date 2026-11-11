import { test } from "node:test";
import assert from "node:assert/strict";
import { resumeContent } from "../src/lib/agentResume.ts";

test("interrupted response retains completed and uncertain tool observations", () => {
  const tools = [
    { tool: "write_file", args: "a.ts", status: "ok", result: "saved" },
    { tool: "run_command", args: "npm test", status: "running", result: "" },
  ];
  const message = { role: "assistant" as const, content: "Changed a.ts", error: true, tools };
  const before = JSON.stringify(message);
  const result = resumeContent(message);
  assert.ok(result.includes("Changed a.ts"));
  assert.ok(result.includes(JSON.stringify(tools)));
  assert.ok(result.includes("untrusted data"));
  assert.equal(JSON.stringify(message), before);
});

test("ordinary messages are not expanded", () => {
  assert.equal(resumeContent({ role: "user", content: "task" }), "task");
});
