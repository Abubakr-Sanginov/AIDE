// VS Code-style snippet body -> plain text + tab stops, and -> CodeMirror snippet template
// (no imports: see tests/).
//
// Supported in the body:
//   $1, ${1}, ${1:placeholder}  - tab stops (same number = linked fields)
//   $0                          - final cursor position
//   \$  \}  \\                  - literal characters
// Everything else is literal text, including JS template strings like `${name}`.

export interface TemplateStop {
  index: number;
  /** Offsets in `text` (a placeholder default is part of the text and is covered by from..to). */
  from: number;
  to: number;
}

type Piece = { lit: string } | { index: number; def: string | null };

function tokenize(body: string): Piece[] {
  const pieces: Piece[] = [];
  let lit = "";
  const flush = () => {
    if (lit) pieces.push({ lit });
    lit = "";
  };
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === "\\" && i + 1 < body.length && "$}\\".includes(body[i + 1])) {
      lit += body[i + 1];
      i += 2;
      continue;
    }
    if (ch === "$") {
      const rest = body.slice(i);
      const simple = /^\$(\d+)/.exec(rest);
      if (simple) {
        flush();
        pieces.push({ index: Number(simple[1]), def: null });
        i += simple[0].length;
        continue;
      }
      const braced = /^\$\{(\d+)(?::((?:\\.|[^\\}])*))?\}/.exec(rest);
      if (braced) {
        flush();
        pieces.push({ index: Number(braced[1]), def: braced[2] === undefined ? null : braced[2].replace(/\\(.)/g, "$1") });
        i += braced[0].length;
        continue;
      }
    }
    lit += ch;
    i++;
  }
  flush();
  return pieces;
}

/** Placeholder text per stop number: the first non-empty default wins (linked fields mirror it). */
function defaults(pieces: Piece[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const p of pieces) {
    if ("index" in p && p.def && !map.has(p.index)) map.set(p.index, p.def);
  }
  return map;
}

/**
 * Body -> text to insert and its tab stops. Stops are ordered by the tab order:
 * 1, 2, ... n, then 0 last (ties keep document order); a repeated number gives one entry per place.
 */
export function parseTemplate(body: string): { text: string; stops: TemplateStop[] } {
  const pieces = tokenize(body);
  const defs = defaults(pieces);
  let text = "";
  const stops: TemplateStop[] = [];
  for (const p of pieces) {
    if ("lit" in p) {
      text += p.lit;
      continue;
    }
    const from = text.length;
    text += p.def ?? defs.get(p.index) ?? "";
    stops.push({ index: p.index, from, to: text.length });
  }
  const rank = (n: number) => (n === 0 ? Number.POSITIVE_INFINITY : n);
  stops.sort((a, b) => rank(a.index) - rank(b.index) || a.from - b.from);
  return { text, stops };
}

// CodeMirror orders numbered fields ascending; VS Code's $0 is the last stop.
const FINAL_FIELD = 100000;

function literal(ch: string): string {
  // In CodeMirror templates a brace must be escaped to stay literal.
  return ch === "{" || ch === "}" ? "\\" + ch : ch;
}

function field(n: number, text: string): string {
  const seq = n === 0 ? FINAL_FIELD : n;
  // CodeMirror placeholders cannot contain braces.
  return "${" + seq + (text ? ":" + text.replace(/[{}]/g, "") : "") + "}";
}

export function toCmTemplate(body: string): string {
  const pieces = tokenize(body);
  const defs = defaults(pieces);
  let out = "";
  for (const p of pieces) {
    if ("lit" in p) {
      for (const ch of p.lit) out += literal(ch);
    } else {
      out += field(p.index, p.def ?? defs.get(p.index) ?? "");
    }
  }
  return out;
}
