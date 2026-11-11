import { useEffect, useMemo, useRef, useState } from "react";
import { Command } from "lucide-react";
import { useI18n } from "@/i18n";
import { isRuLike } from "@/i18n/ruLike";
import { rt } from "@/i18n/tgMap";
import { codeIndexApi, type SymbolHit } from "@/api/codeIndex";
import { absoluteFromIndex } from "@/lib/indexPaths";
import { useTabs } from "@/stores/tabs";
import { useWorkspace } from "@/stores/workspace";
import { useCommands } from "@/stores/commands";
import { Indicator, useIndicator } from "@/ui/Indicator";

interface Row {
  id: string;
  title: string;
  hint?: string;
  go: () => void;
}

export function CommandPalette() {
  const { t, lang } = useI18n();
  const ru = isRuLike(lang);
  const visible = useCommands((s) => s.visible);
  const items = useCommands((s) => s.items);
  const run = useCommands((s) => s.run);
  const close = useCommands((s) => s.close);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(
    () => items.filter((i) => i.title.toLowerCase().includes(query.trim().toLowerCase())),
    [items, query],
  );

  // "@name" → definitions (functions, classes, types) from the code index, like "go to symbol".
  const symbolMode = query.startsWith("@");
  const symbolQuery = query.slice(1).trim();
  const [symbols, setSymbols] = useState<SymbolHit[]>([]);
  useEffect(() => {
    if (!visible || !symbolMode || !symbolQuery) {
      setSymbols([]);
      return;
    }
    let stale = false;
    const timer = window.setTimeout(() => {
      void codeIndexApi
        .symbols(symbolQuery, 30)
        .then((r) => !stale && setSymbols(r))
        .catch(() => !stale && setSymbols([]));
    }, 120);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [visible, symbolMode, symbolQuery]);

  const rows: Row[] = useMemo(() => {
    if (!symbolMode) return filtered.map((i) => ({ id: i.id, title: i.title, hint: i.hint, go: () => run(i.id) }));
    return symbols.map((s, i) => ({
      id: `${s.path}:${s.line}:${i}`,
      title: (s.container ? `${s.container}.` : "") + s.name,
      hint: `${s.kind} · ${s.path}:${s.line}`,
      go: () => {
        const root = useWorkspace.getState().root;
        close();
        if (root) void useTabs.getState().goto(absoluteFromIndex(root, s.path), s.line, 1);
      },
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolMode, filtered, symbols]);

  useEffect(() => {
    if (visible) {
      setQuery("");
      setSelected(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [visible]);

  useEffect(() => { setSelected(0); }, [query]);

  // The highlight glides between commands; its host is also the scrolling list.
  const indicator = useIndicator(`${visible}|${selected}|${query}`);
  const listRef = indicator.ref;

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (!visible) return null;

  return (
    <div
      className="aide-fade fixed inset-0 z-50 flex items-start justify-center bg-black/55 pt-[14vh] backdrop-blur-[2px]"
      onMouseDown={close}
    >
      <div
        className="aide-pop w-[580px] overflow-hidden rounded-xl border border-line-strong bg-overlay shadow-2xl shadow-black/70"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-white/[0.07] px-4">
          <Command size={14} className="shrink-0 text-ink-500" />
          <input
            ref={inputRef}
            value={query}
            placeholder={t("command.placeholder")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelected((s) => Math.min(s + 1, rows.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelected((s) => Math.max(s - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const item = rows[selected];
                if (item) item.go();
              } else if (e.key === "Escape") {
                e.preventDefault();
                close();
              }
            }}
            className="h-12 w-full bg-transparent text-[14px] text-ink-200 placeholder-ink-600 outline-none"
          />
        </div>
        <div ref={listRef} role="listbox" data-noanim className="aide-stagger relative isolate max-h-[340px] overflow-y-auto p-1.5">
          <Indicator box={indicator.box} radius={8} />
          {rows.length === 0 && (
            <div className="px-3 py-3 text-[13px] text-ink-600">
              {symbolMode && !symbolQuery
                ? ru ? rt("Введите имя функции, класса или типа") : "Type the name of a function, class or type"
                : t("command.noResults")}
            </div>
          )}
          {rows.map((item, idx) => (
            <button
              key={item.id}
              data-idx={idx}
              role="option"
              aria-selected={idx === selected}
              onClick={() => item.go()}
              onMouseEnter={() => setSelected(idx)}
              className={
                "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] transition-colors duration-100 " +
                (idx === selected ? "text-ink-50" : "text-ink-400")
              }
            >
              <span className={symbolMode ? "truncate font-mono" : undefined}>{item.title}</span>
              {item.hint && <span className="ml-3 shrink-0 text-[11px] text-ink-600">{item.hint}</span>}
            </button>
          ))}
        </div>
        <div className="border-t border-white/[0.07] px-4 py-1.5 text-[11px] text-ink-600">
          {ru ? rt("@ — найти определение: функцию, класс, тип") : "@ — find a definition: function, class, type"}
        </div>
      </div>
    </div>
  );
}
