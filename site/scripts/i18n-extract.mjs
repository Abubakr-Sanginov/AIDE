// Marks every Russian text in the source pages (index, docs, changelog) with a data-i18n key and writes src/locales/ru.json.
// Idempotent: existing keys are kept, only new texts get new keys. Identical texts share one key.
// Inline formatting is stored as mini-markup: [b]..[/b], [em]..[/em], [code]..[/code], "\n" for <br>.
// Run: npm run i18n:extract
import { readFileSync, writeFileSync } from "node:fs";
import { parse, serialize } from "parse5";

// Source pages (Russian). Keys are shared across pages: the same text gets the same key.
const PAGES = ["index.html", "docs/index.html", "changelog/index.html"].map((p) => new URL("../" + p, import.meta.url));
const OUT = new URL("../src/locales/ru.json", import.meta.url);
const CYR = /[А-Яа-яЁё]/;
const INLINE = new Set(["b", "em", "code", "br", "kbd"]);
const SKIP = new Set(["script", "style", "svg", "pre", "noscript"]);
const ATTRS = ["aria-label", "alt", "title", "content"];

const sources = PAGES.map((file) => ({ file, html: readFileSync(file, "utf8") }));
// Keys already written into any page must never be handed out again.
const taken = new Set();
for (const { html } of sources) {
  for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) taken.add(m[1]);
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) m[1].split(";").forEach((p) => p && taken.add(p.split(":")[1]));
}

const dict = {};          // key -> ru text
const byText = new Map(); // ru text -> key
const counters = {};

const attr = (n, name) => (n.attrs || []).find((a) => a.name === name);
const setAttr = (n, name, value) => { const a = attr(n, name); if (a) a.value = value; else n.attrs.push({ name, value }); };
const isText = (n) => n.nodeName === "#text";
const isEl = (n) => n.tagName !== undefined;

function scopeOf(n) {
  for (let p = n; p; p = p.parentNode) {
    const id = isEl(p) && attr(p, "id");
    if (id && id.value) return id.value.replace(/[^a-z0-9]+/gi, "-");
    if (p.tagName === "head") return "head";
    if (p.tagName === "footer") return "foot";
    if (p.tagName === "header") return "nav";
  }
  return "page";
}
function keyFor(text, n) {
  if (byText.has(text)) return byText.get(text);
  const scope = scopeOf(n);
  let k;
  do { counters[scope] = (counters[scope] || 0) + 1; k = scope + "." + counters[scope]; } while (dict[k] !== undefined || taken.has(k));
  dict[k] = text; byText.set(text, k);
  return k;
}
function remember(k, text) {
  dict[k] = text; if (!byText.has(text)) byText.set(text, k);
  const m = /^(.*)\.(\d+)$/.exec(k);
  if (m) counters[m[1]] = Math.max(counters[m[1]] || 0, Number(m[2]));
}

// Is this element "simple": only text and inline formatting (which itself holds only text)?
function simple(n) {
  return n.childNodes.every((c) => isText(c) || c.nodeName === "#comment" ||
    (isEl(c) && INLINE.has(c.tagName) && (c.tagName === "br" || c.childNodes.every(isText)) && (c.attrs || []).length === 0));
}
function toMarkup(n) {
  return n.childNodes.map((c) => {
    if (isText(c)) return c.value;
    if (c.tagName === "br") return "\n";
    if (isEl(c) && INLINE.has(c.tagName)) return "[" + c.tagName + "]" + c.childNodes.map((t) => t.value).join("") + "[/" + c.tagName + "]";
    return "";
  }).join("").replace(/[ \t]*\n[ \t]*/g, "\n").replace(/[ \t\r]+/g, " ").trim();
}
const textOf = (n) => (isText(n) ? n.value : (n.childNodes || []).map(textOf).join(""));

function walk(n) {
  if (!isEl(n) && n.nodeName !== "#document" && n.nodeName !== "#document-fragment") return;
  if (isEl(n)) {
    // attributes (also on skipped elements such as <pre aria-label>)
    const parts = [];
    const existing = attr(n, "data-i18n-attr");
    const known = new Map((existing ? existing.value.split(";") : []).filter(Boolean).map((p) => p.split(":")));
    for (const name of ATTRS) {
      const a = attr(n, name);
      if (!a || !CYR.test(a.value)) continue;
      const v = a.value.trim();
      const k = known.get(name) || keyFor(v, n);
      if (known.get(name)) remember(k, v);
      parts.push(name + ":" + k);
    }
    if (parts.length) setAttr(n, "data-i18n-attr", parts.join(";"));
    if (SKIP.has(n.tagName)) return;

    if ((attr(n, "translate") || {}).value === "no") return; // e.g. the language menu: native names stay as they are
    // element as a whole
    if (n.childNodes && n.childNodes.length && simple(n) && CYR.test(textOf(n))) {
      const text = toMarkup(n);
      const has = attr(n, "data-i18n");
      if (has) remember(has.value, text); else setAttr(n, "data-i18n", keyFor(text, n));
      return;
    }
  }
  // mixed content: wrap Cyrillic text nodes into spans
  const kids = n.childNodes || [];
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i];
    if (isText(c) && CYR.test(c.value)) {
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(c.value);
      const span = { nodeName: "span", tagName: "span", attrs: [{ name: "data-i18n", value: keyFor(m[2].replace(/\s+/g, " "), n) }], namespaceURI: "http://www.w3.org/1999/xhtml", childNodes: [], parentNode: n };
      span.childNodes.push({ nodeName: "#text", value: m[2], parentNode: span });
      const before = m[1] ? [{ nodeName: "#text", value: m[1], parentNode: n }] : [];
      const after = m[3] ? [{ nodeName: "#text", value: m[3], parentNode: n }] : [];
      kids.splice(i, 1, ...before, span, ...after);
      i += before.length + after.length;
    } else if (isEl(c)) {
      walk(c);
    }
  }
}

for (const { file, html } of sources) {
  const doc = parse(html);
  walk(doc);
  let out = serialize(doc);
  if (!/^<!doctype/i.test(out)) out = "<!doctype html>\n" + out;
  writeFileSync(file, out);
}
const sorted = Object.fromEntries(Object.entries(dict).sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true })));
writeFileSync(OUT, JSON.stringify(sorted, null, 2) + "\n");
console.log("keys:", Object.keys(sorted).length);
