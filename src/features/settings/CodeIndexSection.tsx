import { isRuLike } from "@/i18n/ruLike";
import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { useI18n } from "@/i18n";
import { Btn, Row, Section, inputClass } from "@/features/settings/SettingsPanel";
import { codeIndexApi, type IndexStatus, type SearchHit, type SymbolHit } from "@/api/codeIndex";
import { absoluteFromIndex, ageLabel, num } from "@/lib/indexPaths";
import { useWorkspace } from "@/stores/workspace";
import { useTabs } from "@/stores/tabs";

const TEXT = {
  en: {
    title: "Code index",
    intro: "AIDE reads the project once and keeps a map of it: definitions (functions, classes, types) and a ranked search over names and words. The agent uses it to find the right files itself instead of browsing folders blindly: search_code, find_symbol and project_map.",
    noProject: "Open a project folder to build its index.",
    files: "files",
    lines: "lines",
    symbols: "definitions",
    updated: "updated",
    rebuild: "Rebuild",
    building: "Building…",
    truncated: "The project is larger than the index limit; some files are left out.",
    note: "The index lives in memory and follows your edits and the agent's. Not indexed: .gitignore entries, node_modules and build folders, binaries, minified and very large files, .env files.",
    tryTitle: "Try the search",
    tryHint: "Words as in the code (“refresh token”, “parse config”) or a name. Camel case and snake case are split into words.",
    modeSearch: "Search",
    modeSymbols: "Definitions",
    placeholder: "e.g. permission gate",
    go: "Search",
    nothing: "Nothing found.",
    open: "Open",
  },
  ru: {
    title: "Индекс кода",
    intro: "AIDE один раз читает проект и хранит его карту: определения (функции, классы, типы) и ранжированный поиск по именам и словам. Агент пользуется ею, чтобы самому находить нужные файлы, а не листать папки вслепую: search_code, find_symbol и project_map.",
    noProject: "Откройте папку проекта, чтобы построить индекс.",
    files: "файлов",
    lines: "строк",
    symbols: "определений",
    updated: "обновлён",
    rebuild: "Перестроить",
    building: "Строю…",
    truncated: "Проект больше лимита индекса: часть файлов не вошла.",
    note: "Индекс живёт в памяти и следует за вашими правками и правками агента. Не индексируются: то, что в .gitignore, node_modules и папки сборки, бинарные, минифицированные и очень большие файлы, файлы .env.",
    tryTitle: "Проверить поиск",
    tryHint: "Слова как в коде («refresh token», «parse config») или имя. camelCase и snake_case разбиваются на слова.",
    modeSearch: "Поиск",
    modeSymbols: "Определения",
    placeholder: "например: permission gate",
    go: "Искать",
    nothing: "Ничего не найдено.",
    open: "Открыть",
  },
  tg: {
    title: "Индекси код",
    intro: "AIDE лоиҳаро як бор мехонад ва харитаи онро нигоҳ медорад: таърифҳо (функсияҳо, синфҳо, типҳо) ва ҷустуҷӯи рутбабандишуда аз рӯи номҳо ва калимаҳо. Агент онро барои худаш ёфтани файлҳои лозимӣ истифода мебарад: search_code, find_symbol ва project_map.",
    noProject: "Барои сохтани индекс ҷузвдони лоиҳаро кушоед.",
    files: "файл",
    lines: "сатр",
    symbols: "таъриф",
    updated: "навсозӣ",
    rebuild: "Аз нав сохтан",
    building: "Месозам…",
    truncated: "Лоиҳа аз ҳадди индекс калонтар аст: як қисми файлҳо дохил нашуд.",
    note: "Индекс дар хотира аст ва тағйироти шумо ва агентро пайгирӣ мекунад. Индекс намешаванд: чизҳои .gitignore, node_modules ва ҷузвдонҳои сохт, файлҳои дуӣ, минификатсияшуда ва хеле калон, файлҳои .env.",
    tryTitle: "Санҷиши ҷустуҷӯ",
    tryHint: "Калимаҳо чун дар код («refresh token», «parse config») ё ном. camelCase ва snake_case ба калимаҳо тақсим мешаванд.",
    modeSearch: "Ҷустуҷӯ",
    modeSymbols: "Таърифҳо",
    placeholder: "масалан: permission gate",
    go: "Ҷустан",
    nothing: "Ҳеҷ чиз ёфт нашуд.",
    open: "Кушодан",
  },
};
type Strings = (typeof TEXT)["en"];

function Mode({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={"h-8 rounded-lg px-3 text-[13px] transition-colors " + (active ? "bg-white/10 text-ink-50" : "text-ink-400 hover:bg-white/5 hover:text-ink-100")}
    >
      {children}
    </button>
  );
}

export function CodeIndexSection() {
  const { lang } = useI18n();
  const ru = isRuLike(lang);
  const L: Strings = lang === "tg" ? TEXT.tg : ru ? TEXT.ru : TEXT.en;
  const root = useWorkspace((s) => s.root);
  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"search" | "symbols">("search");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [syms, setSyms] = useState<SymbolHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  const load = useCallback(
    (rebuild: boolean) => {
      if (!root) return;
      setBusy(true);
      setError(null);
      void (rebuild ? codeIndexApi.rebuild() : codeIndexApi.status())
        .then(setStatus)
        .catch((e) => setError(String(e)))
        .finally(() => setBusy(false));
    },
    [root],
  );
  useEffect(() => load(false), [load]);

  const open = (path: string, line: number) => {
    if (!root) return;
    void useTabs.getState().goto(absoluteFromIndex(root, path), line, 1);
  };

  const run = () => {
    const q = query.trim();
    if (!q || searching || !root) return;
    setSearching(true);
    setError(null);
    const done = () => setSearching(false);
    if (mode === "search") {
      void codeIndexApi.search(q, 10).then((r) => { setHits(r); setSyms(null); }).catch((e) => setError(String(e))).finally(done);
    } else {
      void codeIndexApi.symbols(q, 30).then((r) => { setSyms(r); setHits(null); }).catch((e) => setError(String(e))).finally(done);
    }
  };

  const languages = (status?.languages ?? []).filter(([l]) => l !== "text").slice(0, 6);

  return (
    <>
      <Section title={L.title}>
        <Row title={L.title} hint={L.intro} />
        {!root ? (
          <Row title={L.noProject} />
        ) : (
          <Row
            title={
              status ? (
                <span className="tabular-nums">
                  {num(status.files)} {L.files} · {num(status.lines)} {L.lines} · {num(status.symbols)} {L.symbols}
                </span>
              ) : busy ? (
                L.building
              ) : (
                "—"
              )
            }
            hint={
              <>
                {status && status.updatedAt > 0 && (
                  <span>
                    {L.updated} {ageLabel(status.updatedAt, Date.now(), ru)}
                    {status.buildMs > 0 ? ` · ${status.buildMs} ms` : ""}
                  </span>
                )}
                {languages.length > 0 && (
                  <span className="mt-1.5 flex flex-wrap gap-1.5">
                    {languages.map(([l, n]) => (
                      <span key={l} className="rounded bg-white/[0.06] px-1.5 py-px text-[11px] text-ink-300">{l} · {num(n)}</span>
                    ))}
                  </span>
                )}
                {status?.truncated && <span className="mt-1.5 block text-amber-200">{L.truncated}</span>}
                {error && <span role="alert" className="mt-1.5 block break-words text-red-400">{error}</span>}
              </>
            }
          >
            <div className="flex justify-end">
              <Btn onClick={() => load(true)} disabled={busy}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                {busy ? L.building : L.rebuild}
              </Btn>
            </div>
          </Row>
        )}
      </Section>
      <p className="-mt-5 mb-8 px-1 text-[12.5px] leading-5 text-ink-500">{L.note}</p>

      {root && (
        <Section title={L.tryTitle}>
          <Row title={L.tryTitle} hint={L.tryHint}>
            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run(); }}>
              <div className="flex gap-1">
                <Mode active={mode === "search"} onClick={() => setMode("search")}>{L.modeSearch}</Mode>
                <Mode active={mode === "symbols"} onClick={() => setMode("symbols")}>{L.modeSymbols}</Mode>
              </div>
              <input
                aria-label={L.tryTitle}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={L.placeholder}
                spellCheck={false}
                autoComplete="off"
                className={inputClass}
              />
              <Btn type="submit" variant="primary" disabled={!query.trim() || searching}>
                {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                {L.go}
              </Btn>
            </form>
          </Row>
          {hits && hits.length === 0 && <Row title={L.nothing} />}
          {syms && syms.length === 0 && <Row title={L.nothing} />}
          {hits?.map((h) => (
            <Row
              key={h.path}
              title={<span className="break-all font-mono text-[13px]">{h.path}<span className="text-ink-500">:{h.startLine}-{h.endLine}</span></span>}
              hint={
                <>
                  {h.symbols.length > 0 && <span className="text-ink-300">{h.symbols.join(", ")}</span>}
                  <pre className="mt-1.5 overflow-x-auto rounded-lg bg-canvas px-3 py-2 font-mono text-[12px] leading-5 text-ink-300">{h.snippet}</pre>
                </>
              }
            >
              <div className="flex justify-end">
                <Btn onClick={() => open(h.path, h.startLine)}>{L.open}</Btn>
              </div>
            </Row>
          ))}
          {syms?.map((s, i) => (
            <Row
              key={`${s.path}:${s.line}:${i}`}
              title={
                <span className="break-all font-mono text-[13px]">
                  {s.container ? <span className="text-ink-500">{s.container}.</span> : null}
                  {s.name} <span className="text-[11px] text-ink-500">{s.kind}</span>
                </span>
              }
              hint={
                <>
                  <span className="break-all">{s.path}:{s.line}</span>
                  <code className="mt-1 block truncate font-mono text-[12px] text-ink-400">{s.signature}</code>
                </>
              }
            >
              <div className="flex justify-end">
                <Btn onClick={() => open(s.path, s.line)}>{L.open}</Btn>
              </div>
            </Row>
          ))}
        </Section>
      )}
    </>
  );
}
