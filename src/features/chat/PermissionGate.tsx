import { useEffect } from "react";
import { createPortal } from "react-dom";
import { ShieldAlert } from "lucide-react";
import { create } from "zustand";
import { ai, onAiDone, onAiError, onAiPermission } from "@/api/ai";
import { agentNotice } from "@/lib/notify";
import { useI18n } from "@/i18n";

// Permission questions of the agent (and of the Crew roles) are shown by ONE dialog at the top of the
// whole window. They used to live inside the chat panel, so when that panel was not on screen (another
// tab, another mode, the browser opened) the agent waited for an answer nobody could see.

interface Ask {
  requestId: string;
  tool: string;
  args: string;
}

interface GateState {
  queue: Ask[];
  push: (a: Ask) => void;
  /** Drops the questions of a request that has ended or was stopped. */
  forget: (requestId: string) => void;
  answer: (allow: boolean) => void;
}

export const usePermissionGate = create<GateState>((set, get) => ({
  queue: [],
  push: (a) => set((s) => ({ queue: [...s.queue, a] })),
  forget: (requestId) => set((s) => ({ queue: s.queue.filter((x) => x.requestId !== requestId) })),
  answer: (allow) => {
    const first = get().queue[0];
    if (!first) return;
    set((s) => ({ queue: s.queue.slice(1) }));
    void ai.respondPermission(first.requestId, allow).catch(() => {});
  },
}));

let wired = false;
export function ensurePermissionEvents() {
  if (wired) return;
  wired = true;
  const gate = () => usePermissionGate.getState();
  onAiPermission((e) => {
    gate().push({ requestId: e.request_id, tool: e.tool, args: e.args });
    // The agent is blocked until the user answers: tell them even if they are in another window.
    agentNotice("permission", e.tool);
  });
  // A finished or failed request has nothing left to ask.
  onAiDone((e) => gate().forget(e.request_id));
  onAiError((e) => gate().forget(e.request_id));
}

const TEXT = {
  ru: { title: "Агент просит разрешение", allow: "Разрешить", deny: "Отклонить", more: (n: number) => `Ещё запросов в очереди: ${n}` },
  en: { title: "The agent asks for permission", allow: "Allow", deny: "Deny", more: (n: number) => `More requests waiting: ${n}` },
  tg: { title: "Агент иҷозат мепурсад", allow: "Иҷозат додан", deny: "Рад кардан", more: (n: number) => `Дархостҳои дигар дар навбат: ${n}` },
};

export function PermissionGate() {
  const { lang } = useI18n();
  const first = usePermissionGate((s) => s.queue[0]);
  const waiting = usePermissionGate((s) => s.queue.length - 1);
  const answer = usePermissionGate((s) => s.answer);
  const L = TEXT[lang === "tg" ? "tg" : lang === "ru" ? "ru" : "en"];

  // Keyboard: Enter allows, Esc denies (the dialog is modal, so nothing else needs these keys now).
  useEffect(() => {
    if (!first) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        answer(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        answer(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [first, answer]);

  if (!first) return null;
  return createPortal(
    <div className="aide-fade fixed inset-0 z-[120] flex items-center justify-center bg-black/55 px-4 backdrop-blur-[2px]">
      <div role="dialog" aria-modal="true" aria-label={L.title} className="aide-pop w-full max-w-[420px] rounded-3xl border border-line-strong bg-overlay p-5 shadow-2xl shadow-black/70">
        <div className="mb-3 flex items-center gap-2 text-[14px] font-semibold text-ink-50">
          <ShieldAlert size={16} className="text-accent" />
          {L.title}
        </div>
        <div className="mb-4 rounded-xl bg-ink-950/60 px-3 py-2.5">
          <div className="font-mono text-[12.5px] font-semibold text-brand-300">{first.tool}</div>
          <pre className="aide-scroll mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-ink-400">{first.args}</pre>
        </div>
        <div className="flex items-center gap-2">
          {waiting > 0 && <span className="text-[12px] text-ink-500">{L.more(waiting)}</span>}
          <div className="ml-auto flex gap-2">
            <button onClick={() => answer(false)} className="h-9 rounded-xl px-4 text-[13px] text-ink-200 transition-colors hover:bg-white/[0.07]">
              {L.deny}
            </button>
            <button autoFocus onClick={() => answer(true)} className="h-9 rounded-xl bg-accent px-5 text-[13px] font-medium text-canvas transition-[filter] hover:brightness-110">
              {L.allow}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
