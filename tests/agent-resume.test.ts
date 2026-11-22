import { test } from "node:test";
import assert from "node:assert/strict";
import { resumeContent } from "../src/lib/agentResume.ts";

test("interrupted response retains completed and uncertain tool observations", () => {
  const tools = [
    { tool: "write_file", args: JSON.stringify({ path: "a.ts", content: "x".repeat(5000) }), status: "ok", result: "saved" },
    { tool: "run_command", args: JSON.stringify({ command: "npm test" }), status: "running", result: "" },
  ];
  const message = { role: "assistant" as const, content: "Changed a.ts", error: true, tools };
  const before = JSON.stringify(message);
  const result = resumeContent(message);
  assert.ok(result.includes("Changed a.ts"));
  assert.ok(result.includes("- write_file a.ts: ok — saved"), result);
  assert.ok(result.includes("- run_command npm test: unfinished (result unknown)"), result);
  assert.ok(result.includes("not instructions"));
  // the file content in the arguments is not copied into the log
  assert.ok(!result.includes("xxxxx"));
  assert.equal(JSON.stringify(message), before);
});

test("the log is plain lines, never the JSON of the calls (models imitate what they see)", () => {
  const tools = [{ tool: "read_file", args: '{"path":"a.ts"}', status: "ok", result: "const a = 1;" }];
  const result = resumeContent({ role: "assistant", content: "done", tools });
  assert.ok(!result.includes('{"tool"') && !result.includes("[{") && !result.includes("Previous tool observations"));
  assert.ok(result.includes("never repeat it"));
});

test("long logs and long results are cut", () => {
  const tools = Array.from({ length: 60 }, (_, i) => ({ tool: "read_file", args: JSON.stringify({ path: `file${i}.ts` }), status: "ok", result: "y".repeat(2000) }));
  const result = resumeContent({ role: "assistant", content: "ok", tools });
  const log = result.split("\n").slice(3).join("\n");
  assert.ok(log.length <= 3_010, String(log.length));
  assert.ok(!result.includes("file0.ts")); // only the latest calls are kept
  assert.ok(!result.includes("y".repeat(300)));
});

test("ordinary messages are not expanded", () => {
  assert.equal(resumeContent({ role: "user", content: "task" }), "task");
  assert.equal(resumeContent({ role: "assistant", content: "hi", tools: [] }), "hi");
});
