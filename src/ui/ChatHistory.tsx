import { isRuLike } from "@/i18n/ruLike";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { History, Plus, X } from "lucide-react";
import { useI18n } from "@/i18n";

export interface ChatItem {
  id: string;
  title: string;
  updatedAt: number;
  active: boolean;
  /** Open tasks the agent keeps for this chat (its own and handed over by other chats). */
  tasks?: number;
}

const TEXT = {
  en: { newChat: "New chat", history: "Chat history", empty: "No chats yet", untitled: "New chat", remove: "Delete chat", tasks: "Open tasks" },
  ru: { newChat: "Новый чат", history: "История чатов", empty: "Чатов пока нет", untitled: "Новый чат", remove: "Удалить чат", tasks: "Открытых заданий" },
  tg: { newChat: "Чати нав", history: "Таърихи чатҳо", empty: "Ҳоло чат нест", untitled: "Чати нав", remove: "Нест кардани чат", tasks: "Вазифаҳои кушода" },
};

export function useChatText() {
  const { lang } = useI18n();
  return lang === "tg" ? TEXT.tg : isRuLike(lang) ? TEXT.ru : TEXT.en;
}

function formatWhen(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** "New chat" and "History" buttons for a chat panel header. */
export function ChatSessionButtons({
  items,
  busy,
  onNew,
  onOpen,
  onDelete,
}: {
  items: ChatItem[];
  /** Disables switching while a reply is streaming. */
  busy?: boolean;
  onNew: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const T = useChatText();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
  }, []);
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key);
    const close = () => setOpen(false);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const sorted = [...items].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <>
      <button
        type="button"
        title={T.newChat}
        aria-label={T.newChat}
        disabled={busy}
        onClick={onNew}
        className="aide-icon-button size-8 disabled:opacity-35"
      >
        <Plus size={16} />
      </button>
      <button
        ref={btnRef}
        type="button"
        title={T.history}
        aria-label={T.history}
        aria-expanded={open}
        aria-pressed={open}
        onClick={() => setOpen((v) => !v)}
        className="aide-icon-button size-8"
      >
        <History size={16} />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: "fixed", top: pos.top, right: pos.right }}
            className="aide-drop origin-top-right z-[70] flex max-h-[min(420px,70vh)] w-72 flex-col overflow-hidden rounded-xl border border-line-strong bg-overlay shadow-2xl shadow-black/60"
          >
            <div className="shrink-0 border-b border-line px-3 py-2 text-[12px] font-medium text-ink-400">{T.history}</div>
            <div className="aide-scroll aide-stagger min-h-0 flex-1 overflow-y-auto p-1">
              {sorted.length === 0 && <div className="px-3 py-3 text-[13px] text-ink-500">{T.empty}</div>}
              {sorted.map((c) => (
                <div
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  aria-disabled={busy}
                  onClick={() => {
                    if (busy) return;
                    onOpen(c.id);
                    setOpen(false);
                  }}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === " ") && !busy) {
                      e.preventDefault();
                      onOpen(c.id);
                      setOpen(false);
                    }
                  }}
                  className={
                    "group flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] transition-colors " +
                    (c.active ? "bg-white/[0.08] text-ink-50" : "text-ink-200 hover:bg-white/[0.05]") +
                    (busy ? " opacity-50" : "")
                  }
                >
                  <span className="min-w-0 flex-1 truncate">{c.title || T.untitled}</span>
                  {!!c.tasks && (
                    <span title={`${T.tasks}: ${c.tasks}`} className="shrink-0 rounded-full bg-amber-300/15 px-1.5 text-[11px] text-amber-200">
                      {c.tasks}
                    </span>
                  )}
                  <span className="shrink-0 text-[11px] text-ink-500">{formatWhen(c.updatedAt)}</span>
                  <button
                    type="button"
                    title={T.remove}
                    aria-label={T.remove}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(c.id);
                    }}
                    className="flex size-5 shrink-0 items-center justify-center rounded text-ink-500 opacity-0 transition-opacity hover:bg-white/[0.1] hover:text-ink-50 focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
