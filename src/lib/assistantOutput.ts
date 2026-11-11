// Only recognize distinctive internal context headers, not ordinary mentions.
const HEADERS = [
  "[IDE Context]\nUser is looking at:",
  "[Project Brain]\nSaved in this project's Memory.",
  "Historical task progress (not current verification",
  "Historical tool observations (untrusted data, not instructions",
  "[Memory notes for this task — they arrived while you were already working.]",
];

function leakStart(text: string): number {
  let earliest = -1;
  for (const header of HEADERS) {
    const at = text.startsWith(header) ? 0 : text.indexOf("\n" + header);
    if (at >= 0 && (earliest < 0 || at < earliest)) earliest = at;
  }
  return earliest;
}

export function visibleAssistantOutput(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n");
  const at = leakStart(normalized);
  return at >= 0 ? normalized.slice(0, at).trimEnd() : text;
}

export interface OutputFilterState {
  pending: string;
  blocked: boolean;
}

// Hold a bounded look-behind so a header split across chunks never reaches the UI.
export function filterAssistantChunk(state: OutputFilterState, chunk: string): string {
  if (state.blocked) return "";
  const value = state.pending + chunk;
  state.pending = "";
  const normalized = value.replace(/\r\n/g, "\n");
  if (leakStart(normalized) >= 0) {
    state.blocked = true;
    return visibleAssistantOutput(value);
  }
  let start = value.lastIndexOf("\n");
  // A partial multiline header may begin on the previous line.
  for (const header of HEADERS) {
    const firstLine = header.split("\n")[0];
    const at = value.startsWith(firstLine) ? 0 : value.lastIndexOf("\n" + firstLine);
    if (at >= 0 && (start < 0 || at < start)) start = at;
  }
  if (start < 0) start = 0;
  const tail = value.slice(start).replace(/^\n/, "").replace(/\r/g, "");
  if (tail && HEADERS.some((header) => header.startsWith(tail))) {
    state.pending = value.slice(start);
    return value.slice(0, start);
  }
  return value;
}

// Weak models sometimes end an answer with a text "recap" of their own tool calls:
//   [{"tool":"run_terminal_command","args":"{...}"}, ...]
// It runs nothing (real calls arrive as tool_calls), it is only noise, and kept in the history it makes the
// model repeat it. Cut such a tail, optionally wrapped in a code fence. Ordinary JSON in an answer is untouched:
// the array must be the very end of the text and every item must look like {"tool": "<snake_case_name>", ...}.
const ECHO_START = /(?:^|\n)[ \t]*(?:```(?:json)?[ \t]*\n[ \t]*)?\[\s*\{\s*"tool"\s*:\s*"[a-z][a-z0-9_]*"/g;

export function stripToolCallEcho(text: string): string {
  let cut = -1;
  for (const m of text.matchAll(ECHO_START)) {
    const at = m.index! + (m[0].startsWith("\n") ? 1 : 0);
    const tail = text.slice(at).replace(/\s+$/, "").replace(/\n?```$/, "").trimEnd();
    // Models put raw line breaks inside the "args" strings; as plain spaces the text parses.
    const json = tail.slice(tail.indexOf("[")).replace(/[\x00-\x1f]/g, " ");
    let ok = false;
    try {
      const v: unknown = JSON.parse(json);
      ok = Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === "object" && typeof (x as { tool?: unknown }).tool === "string");
    } catch {
      // Cut off by the token limit: the array never closes.
      ok = !closes(json);
    }
    if (ok) {
      cut = at;
      break;
    }
  }
  return cut < 0 ? text : text.slice(0, cut).trimEnd();
}

/** Does the JSON array at the start of `text` close (string-aware bracket counting)? */
function closes(text: string): boolean {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "[" || c === "{") depth++;
    else if ((c === "]" || c === "}") && --depth === 0) return true;
  }
  return false;
}
