import { invoke } from "@tauri-apps/api/core";
import { parse as parseJsonc } from "jsonc-parser";

// VS Code extensions from Open VSX. We never run their code: only declarative parts
// (color themes, snippets, TextMate grammars, language definitions) are used.

export interface ThemeContribution {
  label: string;
  uiTheme?: string;
  path: string;
}
export interface SnippetContribution {
  language: string;
  path: string;
}
export interface GrammarContribution {
  language?: string;
  scopeName: string;
  path: string;
}
export interface LanguageContribution {
  id: string;
  extensions?: string[];
  filenames?: string[];
  aliases?: string[];
}

export interface ExtInfo {
  id: string;
  displayName: string;
  description: string;
  version: string;
  /** Entry point of the extension code (absent for data-only extensions). */
  main: string;
  themes: ThemeContribution[];
  snippets: SnippetContribution[];
  grammars: GrammarContribution[];
  languages: LanguageContribution[];
}

export interface SearchItem {
  namespace: string;
  name: string;
  displayName?: string;
  description?: string;
  version?: string;
  iconUrl?: string;
  downloadCount?: number;
}

export const extApi = {
  search: (query: string, offset: number, category?: string) =>
    invoke<{ total: number; items: SearchItem[] }>("ext_search", { query, offset, category: category ?? null }),
  install: (namespace: string, name: string, confirmLarge = false) => invoke<string>("ext_install", { namespace, name, confirmLarge }),
  list: () => invoke<string[]>("ext_list"),
  remove: (id: string) => invoke<void>("ext_remove", { id }),
  read: (id: string, path: string) => invoke<string>("ext_read", { id, path }),
};

const str = (v: unknown, max = 200): string => (typeof v === "string" ? v.slice(0, max) : "");
const arr = <T>(v: unknown, map: (x: Record<string, unknown>) => T | null): T[] =>
  Array.isArray(v)
    ? v
        .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
        .map(map)
        .filter((x): x is T => x !== null)
        .slice(0, 400)
    : [];

/** Package metadata is untrusted data: every field is type-checked and clipped. */
export function parseManifest(id: string, text: string): ExtInfo | null {
  const raw = parseJsonc(text) as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object") return null;
  const c = (raw.contributes ?? {}) as Record<string, unknown>;
  const nice = (v: unknown) => {
    const s = str(v);
    return s && !s.startsWith("%") ? s : "";
  };
  return {
    id,
    displayName: nice(raw.displayName) || str(raw.name) || id,
    description: nice(raw.description),
    version: str(raw.version, 40),
    main: str(raw.main, 300),
    themes: arr(c.themes, (t) => (str(t.path) ? { label: str(t.label) || str(t.id) || "Theme", uiTheme: str(t.uiTheme, 20), path: str(t.path, 300) } : null)),
    snippets: arr(c.snippets, (s) => (str(s.language) && str(s.path) ? { language: str(s.language, 60), path: str(s.path, 300) } : null)),
    grammars: arr(c.grammars, (g) => (str(g.scopeName) && str(g.path) ? { language: str(g.language, 60) || undefined, scopeName: str(g.scopeName, 120), path: str(g.path, 300) } : null)),
    languages: arr(c.languages, (l) =>
      str(l.id)
        ? {
            id: str(l.id, 60),
            extensions: Array.isArray(l.extensions) ? l.extensions.map((e) => str(e, 30)).filter(Boolean).slice(0, 40) : [],
            filenames: Array.isArray(l.filenames) ? l.filenames.map((e) => str(e, 80)).filter(Boolean).slice(0, 40) : [],
            aliases: Array.isArray(l.aliases) ? l.aliases.map((e) => str(e, 40)).filter(Boolean).slice(0, 10) : [],
          }
        : null,
    ),
  };
}

/** "./themes/a.json" relative to the extension root; rejects anything that climbs out. */
export function cleanPath(p: string): string | null {
  const parts: string[] = [];
  for (const seg of p.replace(/\\/g, "/").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.length > 0 ? parts.join("/") : null;
}

export function joinRel(base: string, rel: string): string | null {
  const dir = base.includes("/") ? base.slice(0, base.lastIndexOf("/")) : "";
  return cleanPath(dir ? `${dir}/${rel}` : rel);
}

/* ── color themes ──────────────────────────────────────── */

export interface TokenRule {
  scope?: string | string[];
  settings: { foreground?: string; background?: string; fontStyle?: string };
}
export interface VsTheme {
  name: string;
  dark: boolean;
  colors: Record<string, string>;
  tokenColors: TokenRule[];
}

export async function loadTheme(extId: string, themePath: string, label: string, uiTheme?: string): Promise<VsTheme | null> {
  const merged: VsTheme = { name: label, dark: uiTheme !== "vs", colors: {}, tokenColors: [] };
  const visit = async (path: string, depth: number): Promise<void> => {
    if (depth > 3) return;
    const text = await extApi.read(extId, path);
    const raw = parseJsonc(text) as Record<string, unknown> | undefined;
    if (!raw || typeof raw !== "object") return;
    if (typeof raw.include === "string") {
      const inc = joinRel(path, raw.include);
      if (inc) await visit(inc, depth + 1).catch(() => {});
    }
    if (raw.type === "light") merged.dark = false;
    if (raw.type === "dark") merged.dark = true;
    if (raw.colors && typeof raw.colors === "object") {
      for (const [k, v] of Object.entries(raw.colors)) if (typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v)) merged.colors[k] = v;
    }
    const tc = (raw.tokenColors ?? raw.settings) as unknown;
    if (Array.isArray(tc)) {
      for (const r of tc) {
        if (!r || typeof r !== "object") continue;
        const s = (r as { settings?: Record<string, unknown> }).settings ?? {};
        const color = (v: unknown) => (typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v) ? v : undefined);
        merged.tokenColors.push({
          scope: (r as { scope?: string | string[] }).scope,
          settings: {
            foreground: color(s.foreground),
            background: color(s.background),
            fontStyle: typeof s.fontStyle === "string" ? s.fontStyle.slice(0, 40) : undefined,
          },
        });
      }
    }
  };
  const start = cleanPath(themePath);
  if (!start) return null;
  await visit(start, 0);
  return merged.tokenColors.length > 0 || Object.keys(merged.colors).length > 0 ? merged : null;
}

/* ── snippets ──────────────────────────────────────────── */

export interface Snippet {
  prefix: string;
  name: string;
  template: string;
}

/** VS Code snippet body → CodeMirror template ("${1:text}", "${}"). */
export function toTemplate(body: string): string {
  return body
    .replace(/\\\$/g, "\u0000") // escaped dollar
    .replace(/\$\{(\d+)\|([^|}]*)[^}]*\}/g, (_m, n, first) => `\${${n}:${String(first).split(",")[0]}}`) // choices → first option
    .replace(/\$\{(\d+):([^${}]*)\}/g, (_m, n, d) => (n === "0" ? d : `\${${n}:${d}}`)) // simple placeholders
    .replace(/\$\{(\d+)\}/g, (_m, n) => (n === "0" ? "${}" : `\${${n}}`))
    .replace(/\$(\d+)/g, (_m, n) => (n === "0" ? "${}" : `\${${n}}`))
    .replace(/\$\{[A-Za-z_]\w*:([^${}]*)\}/g, "$1") // variables with default
    .replace(/\$\{[A-Za-z_]\w*\}|\$[A-Za-z_]\w*/g, "") // variables without default
    .replace(/\u0000/g, "$");
}

export function parseSnippets(text: string): Snippet[] {
  const raw = parseJsonc(text) as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object") return [];
  const out: Snippet[] = [];
  for (const [name, def] of Object.entries(raw).slice(0, 2000)) {
    if (!def || typeof def !== "object") continue;
    const d = def as { prefix?: unknown; body?: unknown };
    const prefixes = (Array.isArray(d.prefix) ? d.prefix : [d.prefix]).filter((p): p is string => typeof p === "string" && p.length > 0 && p.length < 60);
    const body = Array.isArray(d.body) ? d.body.filter((l): l is string => typeof l === "string").join("\n") : typeof d.body === "string" ? d.body : "";
    if (!body || body.length > 20_000) continue;
    for (const prefix of prefixes) out.push({ prefix, name: name.slice(0, 80), template: toTemplate(body) });
  }
  return out;
}
