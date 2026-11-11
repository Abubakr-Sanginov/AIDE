/**
 * Layout-independent key for shortcuts. With a Russian (or any non-Latin)
 * layout `event.key` is "я" instead of "z", so letters/digits/brackets are
 * taken from the physical key (`event.code`).
 */
export function shortcutKey(e: KeyboardEvent): string {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase();
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5);
  switch (e.code) {
    case "BracketLeft":
      return "[";
    case "BracketRight":
      return "]";
    case "Comma":
      return ",";
    case "Equal":
      return "=";
    case "Minus":
      return "-";
  }
  return e.key.toLowerCase();
}
