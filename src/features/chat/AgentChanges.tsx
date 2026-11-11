import { rt } from "@/i18n/tgMap";
import { isRuLike } from "@/i18n/ruLike";
import { useState } from "react";
import { ChevronRight, Undo2 } from "lucide-react";
import { useChanges } from "@/stores/changes";
import { useI18n } from "@/i18n";

/** "Changed N files · Undo" under an agent answer; the list opens on click. */
export function AgentChanges({ requestId }: { requestId: string }) {
  const { lang } = useI18n();
  const ru = isRuLike(lang);
  const tg = lang === "tg";
  const info = useChanges((s) => s.byRequest[requestId]);
  const undone = useChanges((s) => s.undone[requestId]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  if (undone) {
    return <div className="my-1.5 text-[12.5px] text-ink-500">{tg ? `Тағйирот бекор шуд: ${undone.length}` : ru ? `Изменения отменены: ${undone.length}` : `Changes undone: ${undone.length}`}</div>;
  }
  if (!info || info.paths.length === 0) return null;
  const n = info.paths.length;
  const word = tg ? "файл" : ru ? (n % 10 === 1 && n % 100 !== 11 ? "файл" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "файла" : "файлов") : n === 1 ? "file" : "files";
  return (
    <div className="my-1.5 rounded-xl border border-line bg-white/[0.02]">
      <div className="flex items-center gap-2 px-3 py-1.5 text-[13px]">
        <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex items-center gap-1.5 text-ink-200 hover:text-ink-50">
          <ChevronRight size={12} className={"transition-transform " + (open ? "rotate-90" : "")} />
          {tg ? `Тағйир ёфт: ${n} ${word}` : ru ? `Изменено: ${n} ${word}` : `Changed ${n} ${word}`}
        </button>
        <button
          onClick={() => void useChanges.getState().undo(requestId).then((e) => setError(e ?? ""))}
          className="ml-auto flex h-7 items-center gap-1.5 rounded-lg bg-white/[0.07] px-2.5 text-[12.5px] text-ink-100 hover:bg-white/[0.12]"
        >
          <Undo2 size={13} />
          {ru ? rt("Отменить") : "Undo"}
        </button>
      </div>
      {!info.allRestorable && (
        <div className="px-3 pb-1.5 text-[12px] text-amber-300">{ru ? rt("Часть изменений (большие файлы или папки) вернуть нельзя.") : "Some changes (large files or folders) cannot be restored."}</div>
      )}
      {error && <div className="px-3 pb-1.5 text-[12px] text-red-400">{error}</div>}
      {open && (
        <ul className="border-t border-line/60 px-3 py-1.5 font-mono text-[12px] text-ink-300">
          {info.paths.map((p) => (
            <li key={p} className="truncate">
              {p}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
