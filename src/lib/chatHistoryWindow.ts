/**
 * Which messages of a chat go to the model.
 *
 * After /compact the conversation is folded into one summary: the summary and everything after it
 * are sent, the messages before it stay on screen but out of the request. Nothing is lost from
 * view, while the model gets a short handover note instead of the whole history.
 *
 * Kept apart from the store so it can be tested without pulling in the app's runtime.
 */
export function historyFor<T extends { summary?: boolean }>(messages: T[]): T[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].summary) return messages.slice(i);
  }
  return messages;
}
