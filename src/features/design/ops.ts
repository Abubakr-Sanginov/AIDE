import { MAX_HTML_CHARS, assignMissingIds, isAid, parseRoot, sanitizeRoot } from "@/features/design/dom";

// Pure tree operations on the design HTML. Ids are stable: only new elements
// receive ids, so the selection survives every operation.

export interface OpResult {
  html: string;
  /** Elements to select afterwards (new / moved ones). */
  ids: string[];
}

const MARK = "data-mark";

function byId(root: Element, id: string): Element | null {
  return isAid(id) ? root.querySelector(`[data-aid="${id}"]`) : null;
}

function finish(root: Element): OpResult {
  assignMissingIds(root);
  const marked = Array.from(root.querySelectorAll(`[${MARK}]`));
  const ids = marked.map((m) => m.getAttribute("data-aid") ?? "").filter(Boolean);
  for (const m of marked) m.removeAttribute(MARK);
  return { html: root.innerHTML, ids };
}

/** Keeps only topmost elements (drops ones whose ancestor is also in the list). */
function topmost(root: Element, ids: string[]): Element[] {
  const els = ids.map((i) => byId(root, i)).filter((e): e is Element => !!e);
  return els.filter((e) => !els.some((o) => o !== e && o.contains(e)));
}

function stripAids(el: Element) {
  el.removeAttribute("data-aid");
  for (const c of Array.from(el.querySelectorAll("[data-aid]"))) c.removeAttribute("data-aid");
}

export function deleteElements(html: string, ids: string[]): OpResult | null {
  const root = parseRoot(html);
  const els = topmost(root, ids);
  if (els.length === 0) return null;
  for (const e of els) e.remove();
  return { html: root.innerHTML, ids: [] };
}

export function duplicateElements(html: string, ids: string[]): OpResult | null {
  const root = parseRoot(html);
  const els = topmost(root, ids);
  if (els.length === 0) return null;
  for (const e of els) {
    const clone = e.cloneNode(true) as Element;
    stripAids(clone);
    clone.setAttribute(MARK, "1");
    e.after(clone);
  }
  return finish(root);
}

/** Outer HTML of the elements without editor ids (for the clipboard). */
export function copyElements(html: string, ids: string[]): string | null {
  const root = parseRoot(html);
  const els = topmost(root, ids);
  if (els.length === 0) return null;
  return els
    .map((e) => {
      const c = e.cloneNode(true) as Element;
      stripAids(c);
      return c.outerHTML;
    })
    .join("");
}

export type InsertTarget = { id: string; mode: "after" | "inside" } | null;

/** Inserts an HTML fragment (sanitized) after / inside the target, or at the end of the design. */
export function insertFragment(html: string, fragment: string, target: InsertTarget): OpResult | null {
  const root = parseRoot(html);
  const frag = parseRoot(fragment.slice(0, MAX_HTML_CHARS));
  for (const el of Array.from(frag.querySelectorAll("[data-aid]"))) el.removeAttribute("data-aid");
  sanitizeRoot(frag);
  const nodes = Array.from(frag.childNodes);
  if (nodes.length === 0) return null;
  for (const n of nodes) if (n.nodeType === 1) (n as Element).setAttribute(MARK, "1");
  const ref = target ? byId(root, target.id) : null;
  if (ref && target?.mode === "inside") ref.append(...nodes);
  else if (ref) ref.after(...nodes);
  else root.append(...nodes);
  return finish(root);
}

export type MovePos = "before" | "after" | "inside";

export function moveElement(html: string, id: string, targetId: string, pos: MovePos): OpResult | null {
  if (id === targetId) return null;
  const root = parseRoot(html);
  const el = byId(root, id);
  const target = byId(root, targetId);
  if (!el || !target || el.contains(target)) return null;
  if (pos === "before") target.before(el);
  else if (pos === "after") target.after(el);
  else target.append(el);
  return { html: root.innerHTML, ids: [id] };
}

export type ReorderDir = "forward" | "backward" | "front" | "back";

export function reorderElements(html: string, ids: string[], dir: ReorderDir): OpResult | null {
  const root = parseRoot(html);
  const els = topmost(root, ids);
  if (els.length === 0) return null;
  const list = dir === "forward" || dir === "front" ? [...els].reverse() : els;
  let changed = false;
  for (const el of list) {
    const parent = el.parentElement;
    if (!parent) continue;
    const sibs = Array.from(parent.children).filter((c) => c.tagName.toLowerCase() !== "style");
    const i = sibs.indexOf(el);
    if (dir === "forward" && i < sibs.length - 1) {
      sibs[i + 1].after(el);
      changed = true;
    } else if (dir === "backward" && i > 0) {
      sibs[i - 1].before(el);
      changed = true;
    } else if (dir === "front" && i < sibs.length - 1) {
      parent.append(el);
      changed = true;
    } else if (dir === "back" && i > 0) {
      parent.prepend(el);
      changed = true;
    }
  }
  return changed ? { html: root.innerHTML, ids } : null;
}

/** Wraps elements that share the first element's parent into a new group. */
export function groupElements(html: string, ids: string[]): OpResult | null {
  const root = parseRoot(html);
  const els = topmost(root, ids);
  if (els.length === 0) return null;
  const parent = els[0].parentElement;
  if (!parent) return null;
  const same = els.filter((e) => e.parentElement === parent);
  const group = root.ownerDocument.createElement("div");
  group.setAttribute("data-name", "Group");
  group.setAttribute(MARK, "1");
  same[0].before(group);
  // Keep document order inside the group.
  const ordered = Array.from(parent.children).filter((c) => same.includes(c));
  group.append(...ordered);
  return finish(root);
}

export function ungroupElement(html: string, id: string): OpResult | null {
  const root = parseRoot(html);
  const el = byId(root, id);
  if (!el || el.children.length === 0 || !el.parentElement) return null;
  const kids = Array.from(el.children).filter((c) => c.tagName.toLowerCase() !== "style");
  if (kids.length === 0) return null;
  el.replaceWith(...Array.from(el.childNodes));
  return { html: root.innerHTML, ids: kids.map((k) => k.getAttribute("data-aid") ?? "").filter(Boolean) };
}

export function setAttribute(html: string, id: string, name: "data-name" | "data-locked", value: string | null): string | null {
  const root = parseRoot(html);
  const el = byId(root, id);
  if (!el) return null;
  if (value === null || value === "") el.removeAttribute(name);
  else el.setAttribute(name, value.slice(0, 60));
  return root.innerHTML;
}

export function isLocked(html: string, id: string): boolean {
  const el = byId(parseRoot(html), id);
  return !!el?.closest("[data-locked]");
}

/* ── Element presets ───────────────────────────────────────── */

const PLACEHOLDER_IMG =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160"><rect width="240" height="160" fill="#e5e7eb"/><path d="M70 110l32-40 26 30 18-20 24 30z" fill="#cbd5e1"/><circle cx="86" cy="54" r="10" fill="#cbd5e1"/></svg>',
  );

export type PresetId = "text" | "heading" | "button" | "box" | "row" | "image" | "input" | "divider" | "link";

export const PRESETS: Record<PresetId, string> = {
  text: '<p style="margin:0;font-size:16px;color:#111827">Text</p>',
  heading: '<h2 style="margin:0;font-size:32px;font-weight:700;color:#111827">Heading</h2>',
  button:
    '<button style="padding:12px 20px;border:0;border-radius:10px;background:#111827;color:#ffffff;font-size:15px;font-weight:600">Button</button>',
  box: '<div style="padding:24px;border-radius:16px;background:#f3f4f6;min-height:96px;min-width:96px"></div>',
  row:
    '<div style="display:flex;gap:16px;padding:16px"><div style="flex:1;padding:24px;border-radius:12px;background:#f3f4f6;min-height:80px"></div><div style="flex:1;padding:24px;border-radius:12px;background:#f3f4f6;min-height:80px"></div></div>',
  image: `<img alt="" src="${PLACEHOLDER_IMG}" style="width:240px;height:160px;object-fit:cover;border-radius:12px">`,
  input:
    '<input placeholder="Input" style="padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;width:240px">',
  divider: '<hr style="border:0;border-top:1px solid #e5e7eb;margin:16px 0">',
  link: '<a href="#" style="color:#2563eb;font-size:16px;text-decoration:underline">Link</a>',
};

/* ── Queries ───────────────────────────────────────────────── */

const CONTAINERS = new Set(["div", "section", "header", "footer", "main", "nav", "article", "aside", "ul", "ol", "li", "form", "figure", "table", "tbody", "tr", "td", "label"]);

/** True when a new element should be inserted *inside* the given one. */
export function isContainerId(html: string, id: string): boolean {
  const el = byId(parseRoot(html), id);
  return !!el && CONTAINERS.has(el.tagName.toLowerCase());
}

export function siblingIds(html: string, id: string | null): string[] {
  const root = parseRoot(html);
  const el = id ? byId(root, id) : null;
  const parent = el?.parentElement ?? root;
  return Array.from(parent.children)
    .filter((c) => c.tagName.toLowerCase() !== "style")
    .map((c) => c.getAttribute("data-aid") ?? "")
    .filter(Boolean);
}

export function hasId(html: string, id: string): boolean {
  return isAid(id) && html.includes(`data-aid="${id}"`);
}

export function firstChildId(html: string, id: string): string | null {
  const el = byId(parseRoot(html), id);
  const kid = el ? Array.from(el.children).find((c) => c.tagName.toLowerCase() !== "style") : null;
  return kid?.getAttribute("data-aid") ?? null;
}
