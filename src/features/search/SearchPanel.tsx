import { useEffect, useRef, useState, type ReactNode } from "react";
import { FileText, Loader2, Search } from "lucide-react";
import { useI18n } from "@/i18n";
import { fs, type SearchMatch } from "@/api/fs";
import { useWorkspace } from "@/stores/workspace";
import { useTabs } from "@/stores/tabs";
import { joinPath } from "@/lib/fsUtils";

function highlight(text: string, query: string, caseSensitive: boolean): ReactNode {
  const needle = caseSensitive ? query : query.toLowerCase();
  const hay = caseSensitive ? text : text.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  let i = 0;
  while (true) {
    const pos = hay.indexOf(needle, from);
    if (pos === -1) break;
    if (pos > from) parts.push(text.slice(from, pos));
    parts.push(
      <mark key={i++} className="rounded-sm bg-amber-500/25 px-0.5 text-amber-200">
        {text.slice(pos, pos + needle.length)}
      </mark>,
    );
    from = pos + needle.length;
  }
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}

export function SearchPanel() {
  const { t } = useI18n();
  const root = useWorkspace((s) => s.root);
  const goto = useTabs((s) => s.goto);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [results, setResults] = useState<SearchMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [ran, setRan] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const q = query.trim();
    if (!q || !root) {
      setSearching(false);
      setResults([]);
      setRan(false);
      return;
    }
    setSearching(true);
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fs.searchProject(q, caseSensitive, wholeWord);
        setResults(res);
        setRan(true);
      } catch {
        setResults([]);
        setRan(true);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, caseSensitive, wholeWord, root]);

  const toggle = (
    active: boolean,
    label: string,
    set: () => void,
  ) => (
    <button
      onClick={set}
      className={
        "rounded-md px-2 py-0.5 text-[11px] transition-colors " +
        (active
          ? "bg-brand-400/10 text-brand-300"
          : "text-ink-500 hover:bg-white/[0.04] hover:text-ink-300")
      }
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-white/[0.055] px-3 pb-3 pt-3">
        <div className="flex items-center gap-2 rounded-lg border border-white/[0.09] bg-black/20 px-2.5 py-2 shadow-inner transition-colors focus-within:border-brand-400/50">
          <Search size={13} className="shrink-0 text-ink-500" />
          <input
            value={query}
            placeholder={t("search.placeholder")}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-ink-200 placeholder-ink-600 outline-none"
          />
          {searching && <Loader2 size={12} className="shrink-0 animate-spin text-ink-500" />}
        </div>
        <div className="mt-1.5 flex items-center gap-1.5">
          {toggle(caseSensitive, t("search.caseSensitive"), () => setCaseSensitive(!caseSensitive))}
          {toggle(wholeWord, t("search.wholeWord"), () => setWholeWord(!wholeWord))}
          {ran && results.length > 0 && (
            <span className="ml-auto text-[10px] text-ink-600">
              {t("search.results", { count: String(results.length) })}
            </span>
          )}
        </div>
      </div>

      <div className="aide-stagger min-h-0 flex-1 overflow-y-auto pb-2">
        {!root ? (
          <div className="px-4 py-10 text-center text-[12px] leading-5 text-ink-600">
            {t("explorer.openFolderHint")}
            <br />
            {t("explorer.openFolderHint2")}
          </div>
        ) : query.trim() === "" ? (
          <div className="px-4 py-10 text-center text-[12px] text-ink-600">
            {t("search.placeholder")}
          </div>
        ) : ran && results.length === 0 ? (
          <div className="px-4 py-10 text-center text-[12px] text-ink-600">
            {t("search.noResults")}
          </div>
        ) : (
          results.map((r, i) => (
            <button
              key={`${r.path}:${r.line}:${r.column}:${i}`}
              onClick={() => {
                void goto(joinPath(root, r.path), r.line, r.column);
              }}
              className="group block w-full px-3.5 py-2 text-left transition-colors hover:bg-white/[0.04]"
            >
              <div className="flex items-center gap-1.5 text-[12px]">
                <FileText size={11} className="shrink-0 text-ink-600" />
                <span className="min-w-0 flex-1 truncate font-medium text-ink-400 group-hover:text-ink-200">
                  {r.path}
                </span>
                <span className="shrink-0 text-[10px] text-ink-600">
                  {r.line}:{r.column}
                </span>
              </div>
              <div className="mt-0.5 truncate pl-[18px] font-mono text-[11px] leading-4 text-ink-500">
                {highlight(r.text, query.trim(), caseSensitive)}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}