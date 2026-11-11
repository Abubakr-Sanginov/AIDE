import type { Extension } from "@codemirror/state";
import { EditorState } from "@codemirror/state";
import { completeFromList, snippetCompletion, type Completion } from "@codemirror/autocomplete";
import { languageForPath } from "@/lib/editorLang";
import { extApi, joinRel, parseSnippets, type Snippet } from "./manifest";
import { useExtensions } from "./store";
import { textmateExtension } from "./textmate";

const BUILTIN_IDS: Record<string, string> = {
  ts: "typescript", mts: "typescript", tsx: "typescriptreact", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascriptreact",
  json: "json", jsonc: "jsonc", html: "html", htm: "html", css: "css", scss: "scss", less: "less", md: "markdown", rs: "rust", py: "python",
  go: "go", java: "java", c: "c", h: "c", cpp: "cpp", hpp: "cpp", cc: "cpp", cs: "csharp", php: "php", rb: "ruby", sh: "shellscript",
  bash: "shellscript", yaml: "yaml", yml: "yaml", sql: "sql", xml: "xml", vue: "vue", dart: "dart", kt: "kotlin", swift: "swift", lua: "lua",
  toml: "toml", ps1: "powershell", bat: "bat", dockerfile: "dockerfile", svelte: "svelte", r: "r", pl: "perl",
};

/** VS Code language id for a file: installed language definitions first, then a small built-in table. */
export function languageIdForPath(path: string): string | null {
  const name = (path.split(/[\\/]/).pop() ?? "").toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  for (const e of useExtensions.getState().installed) {
    for (const l of e.languages) {
      if (l.filenames?.some((f) => f.toLowerCase() === name)) return l.id;
      if (ext && l.extensions?.some((x) => x.toLowerCase() === ext)) return l.id;
    }
  }
  return BUILTIN_IDS[ext.slice(1)] ?? BUILTIN_IDS[name] ?? null;
}

const snippetCache = new Map<string, Promise<Snippet[]>>();

function snippetsFor(langId: string): Promise<Snippet[]> {
  const { installed, rev } = useExtensions.getState();
  const key = `${rev}:${langId}`;
  let p = snippetCache.get(key);
  if (!p) {
    const jobs: Promise<Snippet[]>[] = [];
    for (const e of installed) {
      for (const s of e.snippets) {
        if (s.language !== langId) continue;
        const rel = joinRel("package.json", s.path);
        if (rel) jobs.push(extApi.read(e.id, rel).then(parseSnippets).catch(() => []));
      }
    }
    p = Promise.all(jobs).then((lists) => lists.flat().slice(0, 3000));
    snippetCache.set(key, p);
    if (snippetCache.size > 40) snippetCache.delete(snippetCache.keys().next().value as string);
  }
  return p;
}

/** Snippet completions + TextMate highlighting for a file, from installed extensions. */
export async function extensionsFor(path: string): Promise<Extension[]> {
  const out: Extension[] = [];
  const store = useExtensions.getState();
  const langId = languageIdForPath(path);
  if (!langId) return out;

  const snippets = await snippetsFor(langId);
  if (snippets.length > 0) {
    const options: Completion[] = snippets.map((s) => snippetCompletion(s.template, { label: s.prefix, detail: s.name, type: "text", boost: -1 }));
    out.push(EditorState.languageData.of(() => [{ autocomplete: completeFromList(options) }]));
  }

  // No CodeMirror parser for this file: try a TextMate grammar from an extension.
  const noParser = Array.isArray(languageForPath(path)) && (languageForPath(path) as unknown[]).length === 0;
  if (noParser) {
    const grammar = store.installed.flatMap((e) => e.grammars).find((g) => g.language === langId);
    if (grammar) {
      const tm = await textmateExtension(store.installed, store.theme, `${store.rev}`, grammar.scopeName);
      if (tm) out.push(tm);
    }
  }
  return out;
}
