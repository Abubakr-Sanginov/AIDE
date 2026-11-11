import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { snippet } from "@codemirror/autocomplete";
import { toCmTemplate } from "../src/features/snippets/template.ts";
import { escapeBody, sanitizeStored, snippetApplies, validateDraft } from "../src/features/snippets/model.ts";

/** Applies the converted template with the real CodeMirror snippet engine. */
function apply(body: string): { text: string; cursor: number } {
  let state = EditorState.create({ doc: "" });
  snippet(toCmTemplate(body))({ state, dispatch: (tr) => (state = tr.state) }, null, 0, 0);
  return { text: state.doc.toString(), cursor: state.selection.main.from };
}

test("placeholders become fields and are inserted as text", () => {
  const r = apply("console.log(${1:value});$0");
  assert.equal(r.text, "console.log(value);");
  assert.equal(r.cursor, "console.log(".length, "first field is selected first");
});

test("literal braces, JS template strings and escapes survive", () => {
  assert.equal(apply("function f() {\n  return `${name}`;\n}").text, "function f() {\n  return `${name}`;\n}");
  assert.equal(apply("cost: \\$5 \\}").text, "cost: $5 }");
});

test("selected code escaped for a body inserts verbatim", () => {
  const code = "const a = `$${x}` + \\$1;";
  assert.equal(apply(escapeBody(code)).text, code);
});

test("validation and file scope", () => {
  assert.equal(validateDraft({ name: "x", prefix: "has space", body: "b", description: "", langs: "" }).ok, false);
  assert.equal(validateDraft({ name: "x", prefix: "log", body: "b", description: "", langs: "<script>" }).ok, false);
  const ok = validateDraft({ name: " Log ", prefix: "log", body: "b", description: "", langs: ".TS, tsx" });
  assert.ok(ok.ok && ok.value.name === "Log" && ok.value.langs.join() === "ts,tsx");
  const s = { id: "1", name: "n", prefix: "p", body: "b", description: "", langs: ["ts"] };
  assert.equal(snippetApplies(s, "D:\\a\\b.TS"), true);
  assert.equal(snippetApplies(s, "/a/b.rs"), false);
  assert.equal(snippetApplies({ ...s, langs: [] }, "/a/Makefile"), true);
});

test("stored data is sanitized", () => {
  const raw = [
    { id: "a", name: "ok", prefix: "ok", body: "x", langs: ["ts"] },
    { id: "a", name: "dup", prefix: "dup", body: "x", langs: [] },
    { id: "../bad", name: "bad id", prefix: "b", body: "x", langs: [] },
    { id: "c", name: "", prefix: "c", body: "x" },
    "junk",
  ];
  assert.deepEqual(sanitizeStored(raw).map((s) => s.id), ["a"]);
  assert.deepEqual(sanitizeStored({ not: "array" }), []);
});
