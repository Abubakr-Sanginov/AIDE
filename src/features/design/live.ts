import { safeStyleValue } from "@/features/design/dom";

// Live documents of the canvas iframes, one per screen (frame). Direct edits
// (drag, resize, text, style fields) are applied to the ACTIVE frame's document
// immediately so the canvas never has to reload.
const docs = new Map<string, Document>();
let activeFrameGetter: () => string = () => "";

/** The store registers how to read the active frame id (avoids a circular import). */
export function registerActiveFrame(getter: () => string) {
  activeFrameGetter = getter;
}

export function setLiveDoc(frameId: string, doc: Document | null) {
  if (doc) docs.set(frameId, doc);
  else docs.delete(frameId);
}

export function getLiveDoc(frameId: string = activeFrameGetter()): Document | null {
  return docs.get(frameId) ?? null;
}

export function liveEl(aid: string | null): HTMLElement | null {
  const doc = getLiveDoc();
  if (!doc || !aid || !/^n\d+$/.test(aid)) return null;
  return doc.querySelector(`[data-aid="${aid}"]`) as HTMLElement | null;
}

export function applyLiveStyles(aid: string, styles: Record<string, string>) {
  const el = liveEl(aid);
  if (!el) return;
  for (const [prop, raw] of Object.entries(styles)) {
    const v = safeStyleValue(prop, raw);
    if (v === null) continue;
    if (v === "") el.style.removeProperty(prop);
    else el.style.setProperty(prop, v);
  }
}

export function applyLiveText(aid: string, text: string) {
  const el = liveEl(aid);
  if (el && el.children.length === 0) el.textContent = text;
}

/** Reads the inline `translate` of an element as numbers. */
export function readTranslate(el: HTMLElement): { x: number; y: number } {
  const parts = (el.style.translate || "").trim().split(/\s+/).filter(Boolean);
  const x = parseFloat(parts[0] ?? "0") || 0;
  const y = parseFloat(parts[1] ?? "0") || 0;
  return { x, y };
}
