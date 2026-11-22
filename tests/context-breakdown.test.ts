import { test } from "node:test";
import assert from "node:assert/strict";
import { barWidths, buildSegments, formatShare, formatTokens, parseBreakdown, totalTokens } from "../src/lib/contextBreakdown.ts";

test("token counts read like in a window meter", () => {
  assert.equal(formatTokens(767), "767");
  assert.equal(formatTokens(23_000), "23K");
  assert.equal(formatTokens(18_200), "18.2K");
  assert.equal(formatTokens(623_400), "623.4K");
  assert.equal(formatTokens(1_000_000), "1M");
  assert.equal(formatTokens(-5), "0");
  assert.equal(formatShare(555_500, 1_000_000), "56%");
  assert.equal(formatShare(2_900, 1_000_000), "0.3%");
  assert.equal(formatShare(5, 0), "0%");
});

test("the backend answer is read defensively", () => {
  assert.equal(parseBreakdown(null), null);
  assert.equal(parseBreakdown("x"), null);
  const b = parseBreakdown({
    system_prompt: 10_600, tools: 23_000, tools_count: 25, mcp_tools: 18_200.4, mcp_count: 167, mcp_names: ["a", 5, "b"],
    mcp_instructions: -1, skills: "ten", skills_count: 3, memory: 2_600, memory_files: [{ name: "AGENTS.md", tokens: 2_600 }, { tokens: 1 }, null],
  });
  assert.equal(b?.systemPrompt, 10_600);
  assert.equal(b?.mcpTools, 18_200);
  assert.deepEqual(b?.mcpNames, ["a", "b"]);
  assert.equal(b?.mcpInstructions, 0); // negative
  assert.equal(b?.skills, 0); // not a number
  assert.deepEqual(b?.memoryFiles, [{ name: "AGENTS.md", tokens: 2_600 }]);
});

test("segments: empty groups disappear, messages stay", () => {
  const b = parseBreakdown({ system_prompt: 100, tools: 200, tools_count: 4, mcp_tools: 0, mcp_instructions: 0, skills: 50, memory: 0 });
  const seg = buildSegments(b, 1_000, 0);
  assert.deepEqual(seg.map((s) => s.key), ["messages", "tools", "prompt", "skills"]);
  assert.equal(totalTokens(seg), 1_350);
  assert.deepEqual(buildSegments(null, 0, 0).map((s) => s.key), ["messages"]);
  assert.deepEqual(buildSegments(null, 10, 1_500).map((s) => s.key), ["messages", "attachments"]);
});

test("bar widths fit the bar even when the window overflows", () => {
  const seg = buildSegments(parseBreakdown({ tools: 500 }), 500, 0);
  assert.deepEqual(barWidths(seg, 2_000), [25, 25]);
  const over = barWidths(seg, 500); // 1000 tokens in a 500 window: scaled to 100% total
  assert.ok(Math.abs(over.reduce((a, b) => a + b, 0) - 100) < 1e-9);
  assert.deepEqual(barWidths(seg, 0), [0, 0]);
});
