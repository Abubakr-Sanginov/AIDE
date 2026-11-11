import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { nextSnippetField, snippet } from "@codemirror/autocomplete";
import { parseTemplate, toCmTemplate } from "../src/features/snippets/template.ts";
import { sanitizeStored, toStored } from "../src/features/snippets/model.ts";

const FOR_BODY = "for ($1) {\n  $0\n}";

test("parseTemplate: $1 and $0 become empty stops in tab order", () => {
  const r = parseTemplate(FOR_BODY);
  assert.equal(r.text, "for () {\n  \n}");
  assert.deepEqual(r.stops, [
    { index: 1, from: 5, to: 5 },
    { index: 0, from: 11, to: 11 },
  ]);
});

test("parseTemplate: ${2:default} puts the default into the text and covers it", () => {
  const r = parseTemplate("a(${2:default}, $1)$0");
  assert.equal(r.text, "a(default, )");
  assert.deepEqual(r.stops, [
    { index: 1, from: 11, to: 11 },
    { index: 2, from: 2, to: 9 },
    { index: 0, from: 12, to: 12 },
  ]);
  assert.equal(r.text.slice(r.stops[1].from, r.stops[1].to), "default");
});

test("parseTemplate: escapes and JS template strings stay literal", () => {
  assert.equal(parseTemplate("\\$1 `${name}`").text, "$1 `${name}`");
  assert.deepEqual(parseTemplate("\\$1").stops, []);
});

test("inserted snippet: cursor on $1, Tab moves to $0", () => {
  let state = EditorState.create({ doc: "" });
  const view = { state, dispatch: (tr: { state: EditorState }) => (state = tr.state) };
  snippet(toCmTemplate(FOR_BODY))(view as never, null, 0, 0);
  assert.equal(state.doc.toString(), "for () {\n  \n}");
  assert.equal(state.selection.main.head, 5, "cursor on $1");
  const moved = nextSnippetField({ state, dispatch: (tr) => (state = tr.state) });
  assert.equal(moved, true);
  assert.equal(state.selection.main.head, 11, "Tab goes to $0");
});

test("storage format aide.snippets.v1 round-trips (lang '*' = any)", () => {
  const list = [
    { id: "a1", name: "for", prefix: "for", body: FOR_BODY, description: "", langs: [] },
    { id: "b2", name: "log", prefix: "log", body: "x", description: "d", langs: ["ts", "tsx"] },
  ];
  const stored = JSON.parse(JSON.stringify(toStored(list)));
  assert.equal(stored[0].lang, "*");
  assert.equal(stored[1].lang, "ts,tsx");
  assert.deepEqual(sanitizeStored(stored), list);
});
