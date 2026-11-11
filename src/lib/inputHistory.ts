// ArrowUp/ArrowDown history for the chat composer: recall previous user messages.
// Pure helpers so the behaviour is testable without React.
export const MAX_HIST = 50;

/** Append a sent message to the history (bounded, blanks ignored). */
export function appendHist(list: string[], text: string): string[] {
  if (!text.trim()) return list;
  return [...list.slice(-(MAX_HIST - 1)), text];
}

/**
 * Index for ArrowUp. `idx === null` means "not browsing" -> jump to the last message.
 * Browsing moves one step older, clamped at the first message.
 */
export function prevIndex(list: string[], idx: number | null): number | null {
  if (list.length === 0) return null;
  if (idx === null) return list.length - 1;
  return Math.max(0, idx - 1);
}

/**
 * Index for ArrowDown. Returns null when walking past the newest message —
 * the caller then restores the saved draft and leaves history browsing.
 */
export function nextIndex(list: string[], idx: number | null): number | null {
  if (idx === null) return null;
  if (idx + 1 >= list.length) return null;
  return idx + 1;
}
