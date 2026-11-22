// Pure logic of the 3D studio preview: a bounded list of images kept only in memory, plus the URL rule of the
// model viewer. No imports from the app, so it runs in plain Node tests.

export interface PreviewImage {
  id: string;
  name: string;
  mime: string;
  /** base64, no prefix */
  data: string;
  /** Tool that produced it (mcp__blender__get_viewport_screenshot, studio_show …). */
  tool: string;
  at: number;
}

export const MAX_ITEMS = 30;
/** Total base64 characters kept for the history (≈ 36 MB of pixels). */
export const MAX_TOTAL_CHARS = 48_000_000;
export const MAX_ITEM_CHARS = 6_000_000;
const SAFE_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Only a raster image with a plain base64 body can become a `data:` URL; anything else is dropped. */
export function isSafeImage(img: { mime: string; data: string }): boolean {
  return SAFE_MIME.has(img.mime) && img.data.length > 0 && img.data.length <= MAX_ITEM_CHARS && BASE64.test(img.data);
}

export function dataUri(img: { mime: string; data: string }): string {
  return `data:${img.mime};base64,${img.data}`;
}

let counter = 0;
export function makeItem(raw: { name?: string; mime: string; data: string }, tool: string, at = Date.now()): PreviewImage | null {
  const item = { mime: String(raw.mime ?? ""), data: String(raw.data ?? "") };
  if (!isSafeImage(item)) return null;
  return { id: `${at}-${++counter}`, name: String(raw.name ?? tool).slice(0, 80), tool: tool.slice(0, 80), at, ...item };
}

/** Appends and trims from the oldest end so the list stays within the item and memory caps. */
export function appendItems(list: PreviewImage[], incoming: PreviewImage[]): PreviewImage[] {
  let next = [...list, ...incoming].slice(-MAX_ITEMS);
  let total = next.reduce((n, i) => n + i.data.length, 0);
  while (next.length > 1 && total > MAX_TOTAL_CHARS) {
    total -= next[0].data.length;
    next = next.slice(1);
  }
  return next;
}

/** The model viewer may only read data:/blob: URLs (embedded textures); a glTF must never make the app fetch an address. */
export function isLocalResourceUrl(url: string): boolean {
  return /^(data:|blob:)/i.test(url.trim());
}

/** Index after a step, wrapping nowhere: the strip stops at the ends. */
export function stepIndex(current: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(length - 1, Math.max(0, current + delta));
}
