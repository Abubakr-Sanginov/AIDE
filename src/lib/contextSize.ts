/**
 * Rough token estimate for what goes to the model.
 *
 * The exact count comes back from the provider only after a request, but the user needs to see
 * what the next request will cost before sending it. Cyrillic and other non-Latin scripts cost
 * noticeably more tokens per character than Latin text, and pretending otherwise would make the
 * fill bar lie on exactly the messages this app is used for.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cyr = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0x0400 && c <= 0x04ff) cyr++;
  }
  const rest = text.length - cyr;
  return Math.ceil(cyr / 2.4 + rest / 4);
}

const WINDOW_KEY = "aide.context.window";

/** Used when neither the model name nor the user tells us the window size. */
export const DEFAULT_WINDOW = 128_000;

/** Window size hinted by the model name: "…-32k", "…-128k", "…-1m". */
export function windowFromModel(model: string): number | null {
  if (!model) return null;
  const k = /(?:^|[^a-z0-9])(\d{1,4})k(?:[^a-z0-9]|$)/i.exec(model);
  if (k) {
    const n = Number(k[1]);
    if (n >= 4 && n <= 2000) return n * 1000;
  }
  if (/(?:^|[^a-z0-9])1m(?:[^a-z0-9]|$)/i.test(model)) return 1_000_000;
  return null;
}

export function loadWindow(): number {
  try {
    const raw = Number(localStorage.getItem(WINDOW_KEY));
    if (Number.isFinite(raw) && raw >= 4096 && raw <= 2_000_000) return raw;
  } catch {}
  return DEFAULT_WINDOW;
}

export function saveWindow(size: number): void {
  try {
    localStorage.setItem(WINDOW_KEY, String(size));
  } catch {}
}
