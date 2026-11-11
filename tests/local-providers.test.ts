import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatContext,
  formatSize,
  canMakeVariant,
  isAideVariant,
  variantName,
  isLocalProvider,
  isLoopbackUrl,
  modelFit,
  normalizeLocalUrl,
  parseLocalUrls,
  sortLocalModels,
  type LocalModelInfo,
} from "../src/lib/localProviders.ts";

const model = (over: Partial<LocalModelInfo>): LocalModelInfo => ({
  id: "m", sizeBytes: null, params: null, quant: null, tools: null, context: null, contextRunning: false, loaded: false, ...over,
});

test("which providers need no key", () => {
  for (const id of ["ollama", "lmstudio", "local-llama-cpp"]) assert.equal(isLocalProvider(id), true, id);
  for (const id of ["openai", "anthropic", "localhost", "my-local", "Ollama"]) assert.equal(isLocalProvider(id), false, id);
});

test("only addresses on this computer count as local", () => {
  for (const u of ["http://localhost:11434/v1", "http://127.0.0.1:1234", "http://127.5.5.5/v1", "http://[::1]:8080/v1"]) {
    assert.equal(isLoopbackUrl(u), true, u);
  }
  for (const u of ["https://localhost", "http://192.168.1.10:11434", "http://example.com", "http://localhost.evil.com", "http://user:pw@localhost", "nonsense", "http://169.254.169.254"]) {
    assert.equal(isLoopbackUrl(u), false, u);
  }
});

test("typed addresses become …/v1 base URLs, remote ones are refused", () => {
  assert.equal(normalizeLocalUrl("http://localhost:11434"), "http://localhost:11434/v1");
  assert.equal(normalizeLocalUrl("http://127.0.0.1:1234/v1/"), "http://127.0.0.1:1234/v1");
  assert.equal(normalizeLocalUrl("http://127.0.0.1:8080/api/openai/v1"), "http://127.0.0.1:8080/api/openai/v1");
  assert.equal(normalizeLocalUrl("http://192.168.0.4:11434"), null);
  assert.equal(normalizeLocalUrl("http://localhost:11434/v1?x=1"), null);
});

test("saved overrides: bad or remote entries are ignored", () => {
  assert.deepEqual(parseLocalUrls(null), {});
  assert.deepEqual(parseLocalUrls("{not json"), {});
  assert.deepEqual(
    parseLocalUrls(JSON.stringify({ ollama: "http://localhost:9999", lmstudio: "http://10.0.0.5:1234/v1", other: "http://localhost:1" })),
    { ollama: "http://localhost:9999/v1" },
  );
});

test("a model that cannot call tools or has a tiny context is flagged for the agent", () => {
  assert.equal(modelFit(model({ tools: true, context: 32768 })), "ok");
  assert.equal(modelFit(model({ tools: false, context: 32768 })), "no-tools");
  assert.equal(modelFit(model({ tools: true, context: 4096 })), "small-context");
  assert.equal(modelFit(model({ tools: null, context: null })), "unknown");
  // No tools is the bigger problem, even when the context is small too.
  assert.equal(modelFit(model({ tools: false, context: 2048 })), "no-tools");
});

test("sorting puts agent-ready models first, then loaded ones", () => {
  const sorted = sortLocalModels([
    model({ id: "embed-like", tools: false }),
    model({ id: "b-unknown", tools: null }),
    model({ id: "a-ready", tools: true, context: 32768 }),
    model({ id: "c-ready-loaded", tools: true, context: 32768, loaded: true }),
    model({ id: "d-small", tools: true, context: 2048 }),
  ]);
  assert.deepEqual(sorted.map((m) => m.id), ["c-ready-loaded", "a-ready", "b-unknown", "d-small", "embed-like"]);
});

test("size and context labels", () => {
  assert.equal(formatSize(5_200_000_000), "4.8 GB");
  assert.equal(formatSize(274_000_000), "261 MB");
  assert.equal(formatSize(null), "");
  assert.equal(formatContext(32768), "32K");
  assert.equal(formatContext(4096), "4K");
  assert.equal(formatContext(null), "");
});

test("the 16K copy: names and when the button is offered", () => {
  assert.equal(variantName("gemma4:12b"), "gemma4:12b-aide-16k");
  assert.equal(variantName("m", 32768), "m-aide-32k");
  assert.equal(isAideVariant("gemma4:12b-aide-16k"), true);
  for (const id of ["gemma4:12b", "x-aide-k", "x-aide-16", "-aide-16k"]) assert.equal(isAideVariant(id), false, id);

  const base = model({ id: "q", tools: true, context: 131072 });
  assert.equal(canMakeVariant(base, [base]), true);
  // already has a copy
  assert.equal(canMakeVariant(base, [base, model({ id: "q-aide-16k" })]), false);
  // copies themselves, models without tools, models that cannot reach 16K
  assert.equal(canMakeVariant(model({ id: "q-aide-16k", tools: true, context: 131072 }), []), false);
  assert.equal(canMakeVariant(model({ id: "e", tools: false, context: 131072 }), []), false);
  assert.equal(canMakeVariant(model({ id: "tiny", tools: true, context: 8192 }), []), false);
  // running with 4K → offer; running with 16K+ → no need
  assert.equal(canMakeVariant(model({ id: "r", tools: true, context: 4096, contextRunning: true }), []), true);
  assert.equal(canMakeVariant(model({ id: "r", tools: true, context: 32768, contextRunning: true }), []), false);
  // unknown capabilities: allowed, Rust checks the real maximum
  assert.equal(canMakeVariant(model({ id: "u" }), []), true);
});
