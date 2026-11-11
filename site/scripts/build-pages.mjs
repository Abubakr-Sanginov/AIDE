// Builds static pages per language from the Russian sources (index, docs, changelog) and
// src/locales/<lang>.json:  /en/, /en/docs/, /en/changelog/, /de/, …
// Text is translated in the HTML itself, so search engines index every language and the pages work
// without JavaScript. Every page (sources included) gets hreflang links and a language menu that
// links to the same page in each language. With an https "url" in site.config.json it also writes
// canonical links, sitemap.xml and robots.txt.
// Run: npm run build (part of it) or node scripts/build-pages.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { parse, serialize, defaultTreeAdapter as ta } from "parse5";

const ROOT = new URL("../", import.meta.url);
const LANGS = ["ru", "en", "de", "fr", "es", "pt", "it", "zh", "ja", "ko", "tg"];
const PAGES = ["", "docs/", "changelog/"]; // folder of each source page, relative to the site root
const HTML_NS = "http://www.w3.org/1999/xhtml";

const config = existsSync(new URL("site.config.json", ROOT)) ? JSON.parse(readFileSync(new URL("site.config.json", ROOT), "utf8")) : {};
const base = typeof config.url === "string" && /^https:\/\/\S+$/.test(config.url) ? config.url.replace(/\/?$/, "/") : "";
if (!base) console.warn("build-pages: site.config.json has no https \"url\" — hreflang links are relative; canonical, sitemap and robots are skipped.");

const depth = (lang, page) => (lang === "ru" ? 0 : 1) + page.split("/").filter(Boolean).length;
const pathOf = (lang, page) => (lang === "ru" ? "" : lang + "/") + page;
/** URL of `page` in `to`, as seen from the same page in `from`. */
const href = (to, page, from) => (base ? base + pathOf(to, page) : "../".repeat(depth(from, page)) + pathOf(to, page) || "./");

const escAttr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
function headBlock(lang, page) {
  const links = LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${escAttr(href(l, page, lang))}">`);
  links.push(`<link rel="alternate" hreflang="x-default" href="${escAttr(href("ru", page, lang))}">`);
  if (base) links.push(`<link rel="canonical" href="${escAttr(href(lang, page, lang))}">`);
  return "<!-- hreflang -->\n  " + links.join("\n  ") + "\n  <!-- /hreflang -->";
}

/* parse5 helpers */
const attr = (n, name) => (n.attrs || []).find((a) => a.name === name);
const setAttr = (n, name, value) => { const a = attr(n, name); if (a) a.value = value; else n.attrs.push({ name, value }); };
function walk(n, fn) { fn(n); (n.childNodes || []).forEach((c) => walk(c, fn)); if (n.content) walk(n.content, fn); }
function clear(n) { n.childNodes.forEach((c) => { c.parentNode = null; }); n.childNodes = []; }
// Mini-markup → nodes: [b] [em] [code] [kbd], "\n" → <br>. Text only, never raw HTML.
function render(n, text) {
  clear(n);
  const put = (s) => s.split("\n").forEach((part, i) => {
    if (i) ta.appendChild(n, ta.createElement("br", HTML_NS, []));
    if (part) ta.insertText(n, part);
  });
  const re = /\[(b|em|code|kbd)\]([\s\S]*?)\[\/\1\]/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    put(text.slice(last, m.index));
    const el = ta.createElement(m[1], HTML_NS, []);
    ta.insertText(el, m[2]);
    ta.appendChild(n, el);
    last = re.lastIndex;
  }
  put(text.slice(last));
}
// A language page lives one folder deeper than its source: every relative URL gets one more "../".
const LOCAL = /^(?![a-z][a-z0-9+.-]*:|\/|#)/i;
const deeper = (u) => (u === "./" ? "../" : LOCAL.test(u) ? "../" + u.replace(/^\.\//, "") : u);

function build(lang, page, source, dict) {
  const missing = [];
  const doc = parse(source.replace(/<!-- hreflang -->[\s\S]*?<!-- \/hreflang -->/, headBlock(lang, page)));
  let head = null;
  walk(doc, (n) => {
    if (!n.tagName) return;
    if (n.tagName === "head") head = n;
    if (n.tagName === "html") {
      setAttr(n, "lang", lang);
      if (lang !== "ru") setAttr(n, "data-page-lang", lang);
    }
    // language menu: the same page in every language
    const to = attr(n, "data-lang");
    if (n.tagName === "a" && to) {
      setAttr(n, "href", href(to.value, page, lang));
      if (to.value === lang) setAttr(n, "aria-current", "true"); else n.attrs = n.attrs.filter((a) => a.name !== "aria-current");
      return;
    }
    if (lang === "ru") return; // sources keep their Russian text and paths
    const key = attr(n, "data-i18n");
    if (key) { if (typeof dict[key.value] === "string") render(n, dict[key.value]); else missing.push(key.value); }
    const pairs = attr(n, "data-i18n-attr");
    if (pairs) pairs.value.split(";").forEach((p) => {
      const [name, k] = p.split(":");
      if (name && typeof dict[k] === "string") setAttr(n, name, dict[k]); else if (name) missing.push(k);
    });
    const rel = attr(n, "rel");
    if (n.tagName === "link" && rel && /alternate|canonical/.test(rel.value)) return;
    // Assets (styles, scripts, images, fonts) live once at the site root, so their paths go one level deeper.
    // Page links (<a>) stay as they are: /ja/docs/ → "../#crew" is /ja/#crew, the same language.
    if (n.tagName === "a" || n.tagName === "use") return;
    for (const name of ["href", "src"]) { const a = attr(n, name); if (a) a.value = deeper(a.value); }
  });
  if (missing.length) throw new Error(`${lang}/${page}: missing keys ${[...new Set(missing)].join(", ")}`);
  if (lang !== "ru") {
    // Strings the script sets at runtime (copy buttons, lite toggle, toast): a JSON data block, not executable.
    const js = Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("js.")));
    const block = ta.createElement("script", HTML_NS, [{ name: "type", value: "application/json" }, { name: "id", value: "i18n-js" }]);
    ta.insertText(block, JSON.stringify(js).replace(/</g, "\\u003c"));
    ta.appendChild(head, block);
  }
  const out = "<!doctype html>\n" + serialize(doc).replace(/^<!DOCTYPE html>/i, "");
  const dir = new URL(pathOf(lang, page), ROOT);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL("index.html", dir), out);
}

let count = 0;
for (const page of PAGES) {
  const source = readFileSync(new URL(page + "index.html", ROOT), "utf8");
  if (!source.includes("<!-- hreflang -->")) throw new Error(`${page || "/"}index.html: missing <!-- hreflang --><!-- /hreflang --> marker`);
  for (const lang of LANGS) {
    const dict = lang === "ru" ? {} : JSON.parse(readFileSync(new URL(`src/locales/${lang}.json`, ROOT), "utf8"));
    build(lang, page, source, dict);
    count++;
  }
}

if (base) {
  const urls = PAGES.flatMap((page) => LANGS.map((l) => {
    const alts = LANGS.map((a) => `    <xhtml:link rel="alternate" hreflang="${a}" href="${href(a, page, l)}"/>`).join("\n");
    return `  <url>\n    <loc>${href(l, page, l)}</loc>\n${alts}\n  </url>`;
  })).join("\n");
  writeFileSync(new URL("sitemap.xml", ROOT), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`);
  writeFileSync(new URL("robots.txt", ROOT), `User-agent: *\nAllow: /\n\nSitemap: ${base}sitemap.xml\n`);
}
console.log(`build-pages: ${count} pages (${PAGES.length} × ${LANGS.length} languages)` + (base ? " + sitemap.xml, robots.txt" : ""));
