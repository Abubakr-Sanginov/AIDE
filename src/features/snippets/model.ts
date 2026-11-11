// Pure snippet helpers (no imports: covered by tests/snippets.test.ts).

export interface Snippet {
  id: string;
  name: string;
  /** Word that triggers the snippet in autocomplete. */
  prefix: string;
  /** VS Code-style body: $1, ${1:text}, $0. */
  body: string;
  description: string;
  /** File extensions without a dot; empty = every file. */
  langs: string[];
}

/** Form state: `langs` is the raw comma-separated text. */
export interface SnippetDraft {
  name: string;
  prefix: string;
  body: string;
  description: string;
  langs: string;
}

export const LIMITS = { name: 80, prefix: 40, body: 20000, description: 300, langs: 20, count: 500 };

/** Same character set as the autocomplete word matcher (`/[\w-]+/`). */
export const PREFIX_RE = /^[A-Za-z0-9_-]{1,40}$/;
const LANG_RE = /^[a-z0-9_+-]{1,15}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export type SnippetErrorKey = "errName" | "errPrefix" | "errBody" | "errLangs";

export const EMPTY_DRAFT: SnippetDraft = { name: "", prefix: "", body: "", description: "", langs: "" };

export function parseLangs(text: string): string[] | null {
  const parts = text
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase().replace(/^\./, ""))
    .filter(Boolean);
  if (parts.length > LIMITS.langs || parts.some((p) => !LANG_RE.test(p))) return null;
  return [...new Set(parts)];
}

export function validateDraft(
  d: SnippetDraft,
): { ok: true; value: Omit<Snippet, "id"> } | { ok: false; error: SnippetErrorKey } {
  const name = d.name.trim();
  if (!name || name.length > LIMITS.name) return { ok: false, error: "errName" };
  const prefix = d.prefix.trim();
  if (!PREFIX_RE.test(prefix)) return { ok: false, error: "errPrefix" };
  if (!d.body.trim() || d.body.length > LIMITS.body) return { ok: false, error: "errBody" };
  const langs = parseLangs(d.langs);
  if (!langs) return { ok: false, error: "errLangs" };
  return {
    ok: true,
    value: { name, prefix, body: d.body, description: d.description.trim().slice(0, LIMITS.description), langs },
  };
}

export function toDraft(s: Snippet): SnippetDraft {
  return { name: s.name, prefix: s.prefix, body: s.body, description: s.description, langs: s.langs.join(", ") };
}

export function extOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function snippetApplies(s: Snippet, path: string): boolean {
  return s.langs.length === 0 || s.langs.includes(extOf(path));
}

export function matchesQuery(s: Snippet, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [s.name, s.prefix, s.description, s.langs.join(" ")].some((v) => v.toLowerCase().includes(q));
}

/** Selected code -> body that inserts literally (escapes `$` and escape-looking backslashes). */
export function escapeBody(text: string): string {
  return text.replace(/\\(?=[$}\\])/g, "\\\\").replace(/\$/g, "\\$");
}

/** Data from localStorage is untrusted: keep only well-formed, valid entries. */
export function sanitizeStored(raw: unknown): Snippet[] {
  if (!Array.isArray(raw)) return [];
  const out: Snippet[] = [];
  const ids = new Set<string>();
  for (const item of raw) {
    if (out.length >= LIMITS.count) break;
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== "string" || !ID_RE.test(r.id) || ids.has(r.id)) continue;
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    // Stored format (aide.snippets.v1): `lang` string, "*" = any; the older `langs` array is still read.
    const langs = Array.isArray(r.langs)
      ? r.langs.filter((x): x is string => typeof x === "string").join(",")
      : typeof r.lang === "string" && r.lang.trim() !== "*"
        ? r.lang
        : "";
    const res = validateDraft({ name: str(r.name), prefix: str(r.prefix), body: str(r.body), description: str(r.description), langs });
    if (!res.ok) continue;
    ids.add(r.id);
    out.push({ id: r.id, ...res.value });
  }
  return out;
}

/** Entry as written to storage under `aide.snippets.v1`. */
export interface StoredSnippet {
  id: string;
  name: string;
  prefix: string;
  /** Comma-separated extensions; "*" = any file. */
  lang: string;
  body: string;
  description: string;
}

export function toStored(list: Snippet[]): StoredSnippet[] {
  return list.map((s) => ({
    id: s.id,
    name: s.name,
    prefix: s.prefix,
    lang: s.langs.length ? s.langs.join(",") : "*",
    body: s.body,
    description: s.description,
  }));
}

const JS = ["js", "jsx", "ts", "tsx", "mjs", "cjs"];

export const SAMPLE_SNIPPETS: Omit<Snippet, "id">[] = [
  { name: "console.log", prefix: "log", body: "console.log(${1:value});$0", description: "Вывод в консоль", langs: JS },
  {
    name: "React-компонент",
    prefix: "rfc",
    body: "export function ${1:Component}() {\n  return <div>$0</div>;\n}\n",
    description: "Функциональный компонент",
    langs: ["tsx", "jsx"],
  },
  {
    name: "try / catch",
    prefix: "trycatch",
    body: "try {\n  $1\n} catch (${2:error}) {\n  $0\n}",
    description: "Обработка ошибки",
    langs: JS,
  },
  {
    name: "Rust-тест",
    prefix: "test",
    body: "#[test]\nfn ${1:name}() {\n    $0\n}",
    description: "Модульный тест",
    langs: ["rs"],
  },
  { name: "TODO", prefix: "todo", body: "TODO: $0", description: "Заметка", langs: [] },
];
