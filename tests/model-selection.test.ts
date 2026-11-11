import { test } from "node:test";
import assert from "node:assert/strict";
import { modelSelection, normalizeModelId } from "../src/lib/modelSelection.ts";

test("manual ID preserves provider syntax and trims pasted whitespace", () => {
  assert.equal(normalizeModelId("  vendor/Model-2:free  "), "vendor/Model-2:free");
  for (const id of ["", "  ", "model\nother", "a b", "a\u0000b", "x".repeat(257)]) {
    assert.throws(() => normalizeModelId(id), /model-id/);
  }
});
test("discovery preserves a private model missing from the provider list", () => {
  assert.deepEqual(modelSelection(["public"], "private/v2"), { models: ["private/v2", "public"], model: "private/v2" });
  assert.deepEqual(modelSelection([], "private/v2"), { models: ["private/v2"], model: "private/v2" });
});
test("a failed discovery can restore the saved model and IDs are not duplicated", () => {
  assert.deepEqual(modelSelection([], "saved"), { models: ["saved"], model: "saved" });
  assert.deepEqual(modelSelection(["saved", "saved"], "saved"), { models: ["saved"], model: "saved" });
});
test("without a saved choice discovery selects its first model", () => {
  assert.equal(modelSelection(["first", "second"], null).model, "first");
  assert.equal(modelSelection(["first"], "bad id").model, "first");
  assert.deepEqual(modelSelection([], null), { models: [], model: "" });
});
