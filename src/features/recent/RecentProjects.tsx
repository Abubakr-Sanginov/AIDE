import { useEffect, useMemo, useRef, useState } from "react";
import { Folder, Search, Trash2, X } from "lucide-react";
import { useI18n } from "@/i18n";
import { useRecent } from "@/stores/recent";
import { useWorkspace } from "@/stores/workspace";
import { basename, dirname } from "@/lib/fsUtils";

export function RecentProjects() {
  const { t, lang } = useI18n();
  const ru = lang === "ru";
  const visible = useRecent((s) => s.visible);
  const close = useRecent((s) => s.close);
  const recents = useWorkspace((s) => s.recents);
  const openPath = useWorkspace((s) => s.openPath);
  const removeRecent = useWorkspace((s) => s.removeRecent);
  const clearRecents = useWorkspace((s) => s.clearRecents);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recents;
    return recents.filter(
      (p) => p.toLowerCase().includes(q) || basename(p).toLowerCase().includes(q),
    );
  }, [recents, query]);

  useEffect(() => {
    if (visible) {
      setQuery("");
      setSelected(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [visible]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    if (selected >= filtered.length) setSelected(Math.max(0, filtered.length - 1));
  }, [filtered.length, selected]);

  if (!visible) return null;

  const open = (path: string) => {
    close();
    void openPath(path).catch(() => {});
  };

  return (
    <div
      className="aide-fade fixed inset-0 z-50 flex items-start justify-center bg-black/55 pt-[10vh] backdrop-blur-[2px]"
      onMouseDown={close}
    >
      <div
        className="aide-pop relative flex w-[560px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-line-strong bg-overlay shadow-2xl shadow-black/70"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          onClick={close}
          aria-label={t("common.close")}
          className="absolute right-3 top-3 z-10 rounded-md p-1 text-ink-500 hover:bg-white/[0.06] hover:text-ink-200"
        >
          <X size={14} />
        </button>

        <div className="flex items-center gap-3 border-b border-white/[0.07] px-4">
          <Search size={14} className="shrink-0 text-ink-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelected((s) => Math.min(s + 1, filtered.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelected((s) => Math.max(s - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const item = filtered[selected];
                if (item) open(item);
              } else if (e.key === "Escape") {
                e.preventDefault();
                close();
              }
            }}
            placeholder={ru ? "Выберите проект для открытия" : "Select to open"}
            className="h-12 w-full bg-transparent pr-7 text-[14px] text-ink-200 outline-none placeholder:italic placeholder:text-ink-500"
          />
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-1.5">
          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-[13px] text-ink-600">
              {recents.length === 0
                ? t("workspace.recentEmpty")
                : t("command.noResults")}
            </div>
          )}
          {filtered.map((path, idx) => {
            const isSel = idx === selected;
            return (
              <div
                key={path}
                data-idx={idx}
                role="option"
                aria-selected={isSel}
                onClick={() => open(path)}
                onMouseEnter={() => setSelected(idx)}
                className={
                  "group flex cursor-pointer items-baseline gap-3 rounded-lg px-3 py-2 " +
                  (isSel ? "bg-[rgba(45,140,205,0.9)]" : "hover:bg-white/[0.04]")
                }
              >
                <span className={"shrink-0 text-[13px] " + (isSel ? "text-white" : "text-ink-100")}>
                  {basename(path)}
                </span>
                <span className={"min-w-0 flex-1 truncate font-mono text-[11px] " + (isSel ? "text-white/80" : "text-ink-600")}>
                  {dirname(path)}
                </span>
                <span
                  className={
                    "shrink-0 text-[11px] " + (isSel ? "text-white/70" : "text-ink-500")
                  }
                >
                  {ru ? "папки" : "folders"}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeRecent(path);
                  }}
                  aria-label={`${t("common.delete")}: ${basename(path)}`}
                  title={t("common.delete")}
                  className={
                    "shrink-0 rounded p-1 transition-opacity " +
                    (isSel
                      ? "text-white/80 opacity-100 hover:bg-white/20 hover:text-white"
                      : "text-ink-500 opacity-0 hover:text-ink-200 group-hover:opacity-100")
                  }
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between border-t border-white/[0.07] px-4 py-2">
          <span className="flex items-center gap-1.5 text-[11px] text-ink-600">
            <Folder size={12} />
            {recents.length}
          </span>
          {recents.length > 0 && (
            <button
              onClick={clearRecents}
              className="text-[11px] text-ink-500 transition-colors hover:text-ink-200"
            >
              {ru ? "Очистить все" : "Clear all"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
