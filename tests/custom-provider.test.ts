import { test } from "node:test";
import assert from "node:assert/strict";
import { providerSlug, validateCustomProvider } from "../src/lib/customProvider.ts";

const cfg = { id: "my-api", name: " My API ", kind: "openai", baseUrl: " https://example.com/v1/ " };
test("identifier follows the complete name and remains valid for short or Cyrillic names", () => {
  assert.equal(providerSlug("M"), "custom");
  assert.equal(providerSlug("My API"), "my-api");
  assert.equal(providerSlug("Мой провайдер"), "custom");
});
test("custom provider values are normalized without changing the API path", () => {
  assert.deepEqual(validateCustomProvider(cfg, []), { ...cfg, name: "My API", baseUrl: "https://example.com/v1" });
  assert.equal(validateCustomProvider({ ...cfg, baseUrl: "http://localhost:11434/v1" }, []).baseUrl, "http://localhost:11434/v1");
});
test("existing built-in and custom provider IDs cannot be overwritten", () => {
  assert.throws(() => validateCustomProvider(cfg, [{ id: "MY-API" }]), /provider-duplicate/);
});
test("reject malformed IDs, unsupported protocols and credentials in URLs", () => {
  for (const baseUrl of ["oops", "javascript:alert(1)", "https://user:secret@example.com/v1", "https://example.com/v1?key=secret"]) {
    assert.throws(() => validateCustomProvider({ ...cfg, baseUrl }, []), /provider-url/);
  }
  assert.throws(() => validateCustomProvider({ ...cfg, id: "m" }, []), /provider-id/);
});
