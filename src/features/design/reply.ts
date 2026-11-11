// A model reply in the Design chat has two parts: a message to the user (prose,
// maybe a question) and, when it designs something, the HTML inside <design>…</design>.

export interface SplitReply {
  /** What the model says to the user. */
  text: string;
  /** The design html (empty when the model only talks or asks). */
  html: string;
  /** True once a design block has started (the reply may still be streaming). */
  designing: boolean;
}

function cleanText(s: string): string {
  return s
    .replace(/```(?:html)?\s*$/i, "")
    .replace(/^\s*```(?:html)?/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Works on partial text too, so the UI can show the message while the design streams. */
export function splitReply(raw: string): SplitReply {
  const open = raw.search(/<design\b[^>]*>/i);
  if (open >= 0) {
    const openMatch = raw.slice(open).match(/^<design\b[^>]*>/i);
    const afterOpen = open + (openMatch?.[0].length ?? 0);
    const closeRel = raw.slice(afterOpen).search(/<\/design\s*>/i);
    const closed = closeRel >= 0;
    const html = closed ? raw.slice(afterOpen, afterOpen + closeRel) : raw.slice(afterOpen);
    const tail = closed ? raw.slice(afterOpen + closeRel).replace(/^<\/design\s*>/i, "") : "";
    return { text: cleanText(raw.slice(0, open) + "\n" + tail), html: html.trim(), designing: true };
  }
  // Fenced html without the wrapper.
  const fence = raw.match(/```html\s*\n([\s\S]*?)(?:```|$)/i);
  if (fence) {
    const text = cleanText(raw.replace(fence[0], ""));
    return { text, html: fence[1].trim(), designing: true };
  }
  // Legacy: the whole reply is html.
  if (/^\s*<(?:div|section|main|style|header|nav|article|form|table|h1|h2|p)\b/i.test(raw)) {
    return { text: "", html: raw.trim(), designing: true };
  }
  return { text: cleanText(raw), html: "", designing: false };
}
