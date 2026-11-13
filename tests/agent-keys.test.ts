import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptableUrl, providerIdFor } from "../src/lib/agentKeys.ts";

test("provider ids are agent-prefixed, safe and unique", () => {
  assert.equal(providerIdFor("found-genspark-tool-cli", []), "agent-genspark-tool-cli");
  assert.equal(providerIdFor("opencode", []), "agent-opencode");
  assert.equal(providerIdFor("found-My Weird/Agent!!", []), "agent-my-weird-agent");
  assert.equal(providerIdFor("found-", []), "agent-agent");
  assert.equal(providerIdFor("opencode", ["agent-opencode"]), "agent-opencode-2");
  assert.equal(providerIdFor("opencode", ["agent-opencode", "agent-opencode-2"]), "agent-opencode-3");
  assert.ok(providerIdFor("x".repeat(100), []).length <= 40);
  // never one of the built-in ids
  for (const id of ["openai", "anthropic", "openrouter", "google"]) assert.ok(providerIdFor(id, []).startsWith("agent-"));
});

test("the key may only be sent to https, or to this computer", () => {
  assert.equal(acceptableUrl("https://api.example.com/v1")?.host, "api.example.com");
  assert.equal(acceptableUrl("  https://api.example.com/v1/ ")?.pathname, "/v1/");
  assert.equal(acceptableUrl("http://localhost:11434/v1")?.port, "11434");
  assert.equal(acceptableUrl("http://127.0.0.1:8080")?.hostname, "127.0.0.1");
  for (const bad of ["http://api.example.com/v1", "http://192.168.1.5:8080", "ftp://x.com", "https://user:pw@x.com", "https://x.com/v1?key=1", "https://x.com/#a", "javascript:alert(1)", "not a url", ""]) {
    assert.equal(acceptableUrl(bad), null, bad);
  }
});
