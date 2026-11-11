// Hover and completion docs from a language server arrive as Markdown, which the LSP client renders to HTML.
// The server is a program we did not write, so that HTML is untrusted: keep a small allowlist of formatting
// tags, drop every attribute except a code-language class, and never keep links, images or scripts.

const ALLOWED = new Set([
  "p", "br", "hr", "pre", "code", "span", "div", "em", "strong", "b", "i", "u", "s", "del", "kbd", "sub", "sup",
  "ul", "ol", "li", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "table", "thead", "tbody", "tr", "th", "td",
]);
// Elements whose content is dropped together with the element.
const DROP = new Set(["script", "style", "iframe", "object", "embed", "template", "svg", "math", "noscript", "link", "meta", "form", "input", "button", "textarea", "select"]);

function clean(node: Node, doc: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.textContent ?? "");
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (DROP.has(tag)) return null;
  const kids = Array.from(el.childNodes).map((c) => clean(c, doc)).filter((c): c is Node => c !== null);
  if (!ALLOWED.has(tag)) {
    // Unknown wrappers (links, images, custom tags): keep only their text content.
    const frag = doc.createDocumentFragment();
    kids.forEach((k) => frag.appendChild(k));
    return frag;
  }
  const out = doc.createElement(tag);
  const cls = el.getAttribute("class");
  if (cls && (tag === "code" || tag === "span" || tag === "pre") && /^[\w\s-]{1,80}$/.test(cls)) out.setAttribute("class", cls);
  kids.forEach((k) => out.appendChild(k));
  return out;
}

/** Returns safe HTML: allowlisted formatting tags only, no attributes besides a plain class name. */
export function sanitizeLspHtml(html: string): string {
  // DOMParser builds an inert document: nothing in it runs or loads.
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const target = document.implementation.createHTMLDocument("");
  const box = target.createElement("div");
  Array.from(parsed.body.childNodes).forEach((n) => {
    const c = clean(n, target);
    if (c) box.appendChild(c);
  });
  return box.innerHTML;
}
