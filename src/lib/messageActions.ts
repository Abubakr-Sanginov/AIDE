// Actions on chat messages: edit a question and ask again, regenerate an answer, delete a message.
// Pure functions over the message list; the store applies them and persists the result.

export interface Msg {
  id: string;
  role: "user" | "assistant";
}

/** The list up to (not including) message `id`: what stays when that message is edited or redone. */
export function truncateBefore<T extends Msg>(messages: readonly T[], id: string): T[] {
  const i = messages.findIndex((m) => m.id === id);
  return i < 0 ? [...messages] : messages.slice(0, i);
}

/**
 * Removing a message: a question goes together with the answer(s) that followed it (an answer alone would hang in
 * the air), an answer goes alone.
 */
export function removeMessage<T extends Msg>(messages: readonly T[], id: string): T[] {
  const i = messages.findIndex((m) => m.id === id);
  if (i < 0) return [...messages];
  if (messages[i].role !== "user") return [...messages.slice(0, i), ...messages.slice(i + 1)];
  let end = i + 1;
  while (end < messages.length && messages[end].role !== "user") end++;
  return [...messages.slice(0, i), ...messages.slice(end)];
}

/** The question an answer belongs to: the nearest user message before it. */
export function questionOf<T extends Msg>(messages: readonly T[], answerId: string): T | null {
  const i = messages.findIndex((m) => m.id === answerId);
  for (let k = i - 1; k >= 0; k--) if (messages[k].role === "user") return messages[k];
  return null;
}

/** Only the last answer can be regenerated: earlier ones are followed by newer turns that depend on them. */
export function isLastAnswer<T extends Msg>(messages: readonly T[], id: string): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") return messages[i].id === id;
  }
  return false;
}
