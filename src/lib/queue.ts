// Pure helpers for the chat message queue (messages written while the agent works).
export interface QueuedItem {
  id: string;
  text: string;
}

export function addQueued(list: QueuedItem[], text: string): QueuedItem[] {
  const trimmed = text.trim();
  if (!trimmed) return list;
  return [...list, { id: crypto.randomUUID(), text: trimmed }];
}

export function removeQueued(list: QueuedItem[], id: string): QueuedItem[] {
  return list.filter((x) => x.id !== id);
}

export function nextQueued(list: QueuedItem[]): { first: QueuedItem; rest: QueuedItem[] } | null {
  if (list.length === 0) return null;
  const [first, ...rest] = list;
  return { first, rest };
}

/** The arrow in the queue row: send this one first, right after the current step ends. */
export function prioritizeQueued(list: QueuedItem[], id: string): QueuedItem[] {
  const item = list.find((x) => x.id === id);
  if (!item) return list;
  return [item, ...list.filter((x) => x.id !== id)];
}
