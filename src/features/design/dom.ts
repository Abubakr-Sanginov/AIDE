// DOM helpers for the Design section.
//
// SECURITY: the design HTML is produced by an LLM, so it is untrusted. Every
// piece of HTML goes through `sanitizeRoot` before it is stored or rendered:
// no scripts, no event handlers, no external resources, no frames/objects.
// The canvas additionally renders it in a sandboxed iframe without
// `allow-scripts`, so even a sanitizer miss cannot execute code.

const FORBIDDEN_TAGS = new Set([
  "script", "iframe", "frame", "frameset", "object", "embed", "applet", "link", "meta",
  "base", "noscript", "template", "audio", "video", "source", "track", "portal",
  "foreignobject", "title", "head",
]);

const URL_ATTRS = new Set(["href", "src", "xlink:href", "action", "formaction", "poster", "srcset", "data", "background"]);

export const MAX_HTML_CHARS = 400_000;

const AID = /^n\d+$/;

export function isAid(v: string | null | undefined): v is string {
  return typeof v === "string" && AID.test(v);
}

export function cleanCss(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, "")
    .replace(/@font-face\s*\{[^}]*\}/gi, "")
    .replace(/url\(\s*(['"]?)(?!data:image\/|#)[^)]*\1\s*\)/gi, "none")
    .replace(/expression\s*\(|behavior\s*:|-moz-binding\s*:/gi, "");
}

function safeUrl(tag: string, name: string, value: string): string | null {
  const v = value.trim();
  if (name === "href" || name === "xlink:href") {
    if (v.startsWith("#")) return v;
    return "#"; // links stay visual only
  }
  if (name === "src" && tag === "img" && /^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(v)) return v;
  return null;
}

function sanitizeElement(el: Element) {
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    if (name.startsWith("on") || name === "srcdoc" || name === "data-aid") {
      el.removeAttribute(attr.name);
    } else if (URL_ATTRS.has(name)) {
      const next = safeUrl(el.tagName.toLowerCase(), name, attr.value);
      if (next === null) el.removeAttribute(attr.name);
      else el.setAttribute(attr.name, next);
    } else if (name === "style") {
      el.setAttribute("style", cleanCss(attr.value));
    }
  }
}

export function sanitizeRoot(root: Element) {
  const all = Array.from(root.querySelectorAll("*"));
  for (const el of all) {
    if (!el.isConnected) continue;
    const tag = el.tagName.toLowerCase();
    if (FORBIDDEN_TAGS.has(tag)) {
      el.remove();
      continue;
    }
    if (tag === "style") {
      el.textContent = cleanCss(el.textContent ?? "");
      continue;
    }
    sanitizeElement(el);
  }
}

/** Gives ids only to elements that have none, so existing ids (and the selection) stay stable. */
export function assignMissingIds(root: Element) {
  let max = 0;
  for (const el of Array.from(root.querySelectorAll("[data-aid]"))) {
    const n = Number((el.getAttribute("data-aid") ?? "").slice(1));
    if (Number.isFinite(n) && n > max) max = n;
  }
  for (const el of Array.from(root.querySelectorAll("*"))) {
    if (!el.hasAttribute("data-aid")) el.setAttribute("data-aid", `n${++max}`);
  }
}

export function assignIds(root: Element) {
  let i = 0;
  for (const el of Array.from(root.querySelectorAll("*"))) {
    el.setAttribute("data-aid", `n${++i}`);
  }
}

export function parseRoot(html: string): Element {
  const doc = new DOMParser().parseFromString(
    `<!doctype html><html><body><div data-root>${html}</div></body></html>`,
    "text/html",
  );
  return doc.querySelector("[data-root]") as Element;
}

/** Sanitizes untrusted HTML and returns a clean fragment with fresh ids. */
export function cleanHtml(html: string): string {
  const root = parseRoot(html.slice(0, MAX_HTML_CHARS));
  sanitizeRoot(root);
  assignIds(root);
  return root.innerHTML;
}

export function stripIds(html: string): string {
  const root = parseRoot(html);
  for (const el of Array.from(root.querySelectorAll("[data-aid],[data-name],[data-locked]"))) {
    el.removeAttribute("data-aid");
    el.removeAttribute("data-name");
    el.removeAttribute("data-locked");
  }
  return root.innerHTML;
}

/** Pulls an HTML fragment out of a model reply (fences, full documents). */
export function extractHtml(text: string): string {
  let t = text.trim();
  const fence = t.match(/```[a-zA-Z]*\s*\n([\s\S]*?)\n?```/);
  if (fence) t = fence[1].trim();
  if (/<html|<!doctype|<body/i.test(t)) {
    const doc = new DOMParser().parseFromString(t, "text/html");
    const styles = Array.from(doc.head.querySelectorAll("style")).map((s) => s.outerHTML).join("\n");
    return `${styles}\n${doc.body.innerHTML}`.trim();
  }
  return t;
}

export function elementOuterHtml(html: string, aid: string): string | null {
  if (!isAid(aid)) return null;
  const root = parseRoot(html);
  const el = root.querySelector(`[data-aid="${aid}"]`);
  if (!el) return null;
  const clone = el.cloneNode(true) as Element;
  clone.removeAttribute("data-aid");
  for (const c of Array.from(clone.querySelectorAll("[data-aid]"))) c.removeAttribute("data-aid");
  return clone.outerHTML;
}

/** Replaces (or removes, when `replacement` is empty) the element and returns the new html + id of the new element. */
export function replaceElement(
  html: string,
  aid: string,
  replacement: string,
): { html: string; newId: string | null } | null {
  if (!isAid(aid)) return null;
  const root = parseRoot(html);
  const target = root.querySelector(`[data-aid="${aid}"]`);
  if (!target) return null;
  let marked: Element | null = null;
  if (replacement.trim()) {
    const frag = parseRoot(replacement.slice(0, MAX_HTML_CHARS));
    sanitizeRoot(frag);
    const nodes = Array.from(frag.childNodes);
    marked = (nodes.find((n) => n.nodeType === 1 && (n as Element).tagName.toLowerCase() !== "style") as Element) ?? null;
    marked?.setAttribute("data-mark", "1");
    target.replaceWith(...nodes);
  } else {
    target.remove();
  }
  assignIds(root);
  const newEl = root.querySelector("[data-mark]");
  const newId = newEl?.getAttribute("data-aid") ?? null;
  newEl?.removeAttribute("data-mark");
  return { html: root.innerHTML, newId };
}

export interface LayerNode {
  id: string;
  tag: string;
  label: string;
  name: string;
  depth: number;
  hasChildren: boolean;
  hidden: boolean;
  locked: boolean;
}

export function buildLayers(html: string): LayerNode[] {
  const root = parseRoot(html);
  const out: LayerNode[] = [];
  const walk = (el: Element, depth: number) => {
    for (const child of Array.from(el.children)) {
      const tag = child.tagName.toLowerCase();
      if (tag === "style") continue;
      const id = child.getAttribute("data-aid");
      if (!id) continue;
      const own = Array.from(child.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent?.trim() ?? "")
        .join(" ")
        .trim();
      const cls = child.getAttribute("class")?.split(/\s+/)[0];
      const label = own ? own.slice(0, 28) : child.id ? `#${child.id}` : cls ? `.${cls}` : "";
      out.push({
        id,
        tag,
        label,
        name: child.getAttribute("data-name") ?? "",
        depth,
        hasChildren: Array.from(child.children).some((c) => c.tagName.toLowerCase() !== "style"),
        hidden: (child as HTMLElement).style.display === "none",
        locked: child.hasAttribute("data-locked"),
      });
      walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

const BASE_CSS =
  "*,*::before,*::after{box-sizing:border-box}html{overflow:hidden}" +
  "body{margin:0;background:#fff;color:#111827;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;line-height:1.5;-webkit-font-smoothing:antialiased}" +
  "a{color:inherit}img,svg{max-width:100%}";

/** Full document for the canvas iframe (ids kept) or for export (ids stripped). */
const CANVAS_CSS =
  "html{user-select:none;-webkit-user-select:none}[contenteditable]{user-select:text;-webkit-user-select:text;outline:none;cursor:text}img{-webkit-user-drag:none}";

export function buildDocument(
  html: string,
  opts: { forExport?: boolean; canvas?: boolean; title?: string } = {},
): string {
  const body = opts.forExport ? stripIds(html) : html;
  const csp = opts.forExport
    ? ""
    : `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">`;
  const title = (opts.title ?? "Design").replace(/[<>&"]/g, "");
  return `<!doctype html><html><head><meta charset="utf-8">${csp}<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${BASE_CSS}${opts.canvas ? CANVAS_CSS : ""}</style></head><body>${body}</body></html>`;
}

/** Simple pretty printer for the code view. */
export function prettyHtml(html: string): string {
  const root = parseRoot(stripIds(html));
  const VOID = new Set(["br", "hr", "img", "input", "meta", "link", "path", "circle", "rect", "line", "polyline", "polygon", "ellipse"]);
  const lines: string[] = [];
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const walk = (node: Node, depth: number) => {
    const pad = "  ".repeat(depth);
    if (node.nodeType === 3) {
      const t = (node.textContent ?? "").trim();
      if (t) lines.push(pad + esc(t));
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const attrs = Array.from(el.attributes).map((a) => ` ${a.name}="${a.value.replace(/"/g, "&quot;")}"`).join("");
    if (VOID.has(tag) && el.childNodes.length === 0) {
      lines.push(`${pad}<${tag}${attrs} />`);
      return;
    }
    if (tag === "style") {
      lines.push(`${pad}<style>`);
      for (const l of (el.textContent ?? "").trim().split("\n")) lines.push(`${pad}  ${l.trim()}`);
      lines.push(`${pad}</style>`);
      return;
    }
    const kids = Array.from(el.childNodes).filter((n) => n.nodeType === 1 || (n.textContent ?? "").trim());
    if (kids.length === 1 && kids[0].nodeType === 3) {
      lines.push(`${pad}<${tag}${attrs}>${esc(kids[0].textContent!.trim())}</${tag}>`);
      return;
    }
    lines.push(`${pad}<${tag}${attrs}>`);
    for (const k of kids) walk(k, depth + 1);
    lines.push(`${pad}</${tag}>`);
  };
  for (const n of Array.from(root.childNodes)) walk(n, 0);
  return lines.join("\n");
}

/* ── Direct-edit helpers ───────────────────────────────────── */

/** CSS properties the editor may set inline. */
export const EDITABLE_STYLES = new Set([
  "color", "background-color", "font-size", "font-weight", "border-radius", "opacity",
  "width", "height", "translate", "padding", "margin", "text-align", "line-height",
  "letter-spacing", "min-width", "max-width", "min-height", "font-family", "font-style",
  "text-decoration", "box-shadow", "border-width", "border-style", "border-color", "display",
  "flex-direction", "flex-wrap", "justify-content", "align-items", "gap", "background-image",
  "object-fit", "text-transform",
]);

/** Values are untrusted too: no url(), no expressions, no declaration breaking. */
export function safeStyleValue(prop: string, value: string): string | null {
  if (!EDITABLE_STYLES.has(prop)) return null;
  const v = value.trim();
  if (v.length > 200) return null;
  if (prop === "background-image" && v !== "" && v !== "none" && !/^(linear|radial)-gradient\(/i.test(v)) return null;
  if (/[;{}<>\\]|url\(|expression|@import|javascript:/i.test(v)) return null;
  return v;
}

export function updateElementStyles(html: string, aid: string, styles: Record<string, string>): string | null {
  if (!isAid(aid)) return null;
  const root = parseRoot(html);
  const el = root.querySelector(`[data-aid="${aid}"]`) as HTMLElement | null;
  if (!el) return null;
  for (const [prop, raw] of Object.entries(styles)) {
    const v = safeStyleValue(prop, raw);
    if (v === null) continue;
    if (v === "") el.style.removeProperty(prop);
    else el.style.setProperty(prop, v);
  }
  if (!el.getAttribute("style")) el.removeAttribute("style");
  return root.innerHTML;
}

export function isLeafElement(el: Element): boolean {
  return el.children.length === 0 && !["img", "svg", "input", "hr", "br", "style"].includes(el.tagName.toLowerCase());
}

export function updateElementText(html: string, aid: string, text: string): string | null {
  if (!isAid(aid)) return null;
  const root = parseRoot(html);
  const el = root.querySelector(`[data-aid="${aid}"]`);
  if (!el || !isLeafElement(el)) return null;
  el.textContent = text.slice(0, 2000);
  return root.innerHTML;
}

export function parentId(html: string, aid: string): string | null {
  if (!isAid(aid)) return null;
  const root = parseRoot(html);
  const el = root.querySelector(`[data-aid="${aid}"]`);
  const p = el?.parentElement;
  if (!p || p === root) return null;
  return p.getAttribute("data-aid");
}

/** A readable name for a design without chat messages: its first heading. */
export function guessTitle(html: string): string {
  if (!html) return "";
  const root = parseRoot(html);
  const el = root.querySelector("h1,h2,h3,h4") ?? root.querySelector("p,button,a");
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 48);
}

/* ── Multi-screen responses ────────────────────────────────── */

export interface FrameBlock {
  name: string;
  device: "desktop" | "tablet" | "mobile" | null;
  /** Unsanitized html: shared top-level styles + the frame's own content. */
  html: string;
}

/**
 * Splits a model reply into screens: top-level elements carrying `data-frame`.
 * Top-level <style> elements are shared by every screen. Returns [] when the
 * reply is a single, unwrapped design.
 */
export function parseFrameBlocks(fragment: string): FrameBlock[] {
  const root = parseRoot(fragment.slice(0, MAX_HTML_CHARS));
  const shared = Array.from(root.children)
    .filter((c) => c.tagName.toLowerCase() === "style")
    .map((c) => c.outerHTML)
    .join("");
  const blocks: FrameBlock[] = [];
  for (const el of Array.from(root.children)) {
    if (!el.hasAttribute("data-frame")) continue;
    const d = el.getAttribute("data-device");
    blocks.push({
      name: (el.getAttribute("data-frame") ?? "").trim().slice(0, 60),
      device: d === "desktop" || d === "tablet" || d === "mobile" ? d : null,
      html: shared + el.innerHTML,
    });
  }
  return blocks;
}
