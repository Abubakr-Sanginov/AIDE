// Searching and reading chat sessions for the agent. Everything here is plain text: the chats may contain
// anything (pasted web pages, tool output), so the agent is told to treat it as data, never as instructions.

export interface SessionMessage {
  role: string;
  content: string;
}

export interface SessionLike {
  id: string;
  title: string;
  updatedAt: number;
  messages: SessionMessage[];
}

const MAX_QUERY_WORDS = 8;

export function queryWords(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter((w) => w.length > 1))].slice(0, MAX_QUERY_WORDS);
}

/** A short piece of `text` around the first hit of any word, with ellipses where it was cut. */
export function snippet(text: string, words: string[], radius = 80): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const lower = flat.toLowerCase();
  let at = -1;
  for (const w of words) {
    const i = lower.indexOf(w);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return flat.slice(0, radius * 2);
  const from = Math.max(0, at - radius);
  const to = Math.min(flat.length, at + radius);
  return (from > 0 ? "…" : "") + flat.slice(from, to) + (to < flat.length ? "…" : "");
}

export interface SessionHit {
  id: string;
  title: string;
  updatedAt: number;
  score: number;
  snippets: string[];
}

/** Sessions ranked by how many query words they contain (a title hit counts double); at most `limit`. */
export function searchSessions(sessions: SessionLike[], query: string, limit = 8): SessionHit[] {
  const words = queryWords(query);
  if (words.length === 0) return [];
  const hits: SessionHit[] = [];
  for (const s of sessions) {
    const title = s.title.toLowerCase();
    let score = 0;
    for (const w of words) if (title.includes(w)) score += 2;
    const snippets: string[] = [];
    const seen = new Set<string>();
    for (const m of s.messages) {
      const lower = m.content.toLowerCase();
      const found = words.filter((w) => lower.includes(w));
      if (found.length === 0) continue;
      for (const w of found) seen.add(w);
      if (snippets.length < 2) snippets.push(`${m.role === "user" ? "Вы" : "Агент"}: ${snippet(m.content, found)}`);
    }
    score += seen.size;
    if (score > 0) hits.push({ id: s.id, title: s.title, updatedAt: s.updatedAt, score, snippets });
  }
  return hits.sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt).slice(0, limit);
}

/** The last `n` messages of a session, each cut to `chars` characters. */
export function lastMessages(s: SessionLike, n = 10, chars = 600): string[] {
  const count = Math.max(1, Math.min(20, Math.floor(n) || 10));
  return s.messages
    .filter((m) => m.content.trim())
    .slice(-count)
    .map((m) => `${m.role === "user" ? "Пользователь" : "Агент"}: ${m.content.length > chars ? m.content.slice(0, chars) + "…" : m.content}`);
}
