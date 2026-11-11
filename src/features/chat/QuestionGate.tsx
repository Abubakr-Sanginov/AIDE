import { rt } from "@/i18n/tgMap";
import { isRuLike } from "@/i18n/ruLike";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CircleHelp, Square } from "lucide-react";
import { create } from "zustand";
import { ai, onAiDone, onAiError, onAiQuestion, type QuestionItem } from "@/api/ai";
import { useI18n } from "@/i18n";
import { useAi } from "@/stores/ai";
import { agentNotice } from "@/lib/notify";

// Clarifying questions of the agent (ask_user): ONE dialog at the top of the whole window,
// like permissions, so it is visible from any tab or mode.
// Only unanswered questions render buttons; pressing "Send" returns ready answers to the model.

interface Ask {
  requestId: string;
  questions: QuestionItem[];
}

interface GateState {
  queue: Ask[];
  push: (a: Ask) => void;
  forget: (requestId: string) => void;
  answer: (answers: { questionId: string; answer: string }[]) => void;
}

export const useQuestionGate = create<GateState>((set, get) => ({
  queue: [],
  push: (a) => set((s) => ({ queue: [...s.queue, a] })),
  forget: (requestId) => set((s) => ({ queue: s.queue.filter((x) => x.requestId !== requestId) })),
  answer: (answers) => {
    const first = get().queue[0];
    if (!first) return;
    set((s) => ({ queue: s.queue.slice(1) }));
    void ai.respondQuestion(first.requestId, answers).catch(() => {});
  },
}));

let wired = false;
export function ensureQuestionEvents() {
  if (wired) return;
  wired = true;
  const gate = () => useQuestionGate.getState();
  onAiQuestion((e) => {
    gate().push({ requestId: e.request_id, questions: e.questions });
    const first = e.questions[0]?.question?.trim();
    if (first) agentNotice("question", first);
  });
  onAiDone((e) => gate().forget(e.request_id));
  onAiError((e) => gate().forget(e.request_id));
}

const TEXT = {
  ru: { title: "Агент уточняет", send: "Отправить ответы", custom: "Свой ответ…", skip: "Пропустить" },
  en: { title: "The agent would like to clarify", send: "Send answers", custom: "Custom answer…", skip: "Skip" },
  tg: { title: "Агент мушаххас мекунад", send: "Ҷавобҳо фиристодан", custom: "Ҷавоби худ…", skip: "Гузаштан" },
};

export function QuestionGate() {
  const { lang } = useI18n();
  const ru = isRuLike(lang);
  const first = useQuestionGate((s) => s.queue[0]);
  const waiting = useQuestionGate((s) => s.queue.length - 1);
  const answer = useQuestionGate((s) => s.answer);
  const stop = useAi((s) => s.stop);
  const L = TEXT[lang === "tg" ? "tg" : lang === "ru" ? "ru" : "en"];

  const [selected, setSelected] = useState<Record<number, string[]>>({});
  const [custom, setCustom] = useState<Record<number, string>>({});

  useEffect(() => {
    setSelected({});
    setCustom({});
  }, [first?.requestId]);

  if (!first) return null;

  const toggle = (qi: number, label: string, multiple: boolean) => {
    setSelected((s) => {
      const cur = s[qi] ?? [];
      if (multiple) {
        return { ...s, [qi]: cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label] };
      }
      return { ...s, [qi]: cur.includes(label) ? [] : [label] };
    });
  };

  const send = () => {
    const answers = first.questions.map((_q, i) => {
      const parts = [...(selected[i] ?? [])];
      const c = (custom[i] ?? "").trim();
      if (c) parts.push(c);
      return { questionId: `q${i + 1}`, answer: parts.join(", ") };
    });
    answer(answers);
  };

  return createPortal(
    <div className="aide-fade fixed inset-0 z-[120] flex items-center justify-center bg-black/55 px-4 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={L.title}
        className="aide-pop w-full max-w-[520px] rounded-3xl border border-line-strong bg-overlay p-5 shadow-2xl shadow-black/70"
      >
        <div className="mb-4 flex items-center gap-2 text-[14px] font-semibold text-ink-50">
          <CircleHelp size={16} className="text-accent" />
          {L.title}
          <button
            onClick={stop}
            title={ru ? rt("Остановить") : "Stop"}
            aria-label={ru ? rt("Остановить") : "Stop"}
            className="aide-icon-button ml-auto size-7"
          >
            <Square size={12} />
          </button>
        </div>
        <div className="aide-scroll max-h-[60vh] space-y-4 overflow-y-auto">
          {first.questions.map((q, i) => (
            <div key={i}>
              <div className="mb-1.5 text-[13px] font-medium text-ink-100">{q.question}</div>
              {(q.options ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {(q.options ?? []).map((o) => {
                    const on = (selected[i] ?? []).includes(o.label);
                    return (
                      <button
                        key={o.label}
                        onClick={() => toggle(i, o.label, Boolean(q.multiple))}
                        aria-pressed={on}
                        className={
                          "rounded-full border px-3 py-1 text-[12.5px] transition-colors " +
                          (on
                            ? "border-transparent bg-accent font-medium text-canvas"
                            : "border-line-strong bg-white/[0.04] text-ink-200 hover:bg-white/[0.08]")
                        }
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              )}
              {q.allow_custom !== false && (
                <input
                  value={custom[i] ?? ""}
                  onChange={(e) => setCustom((s) => ({ ...s, [i]: e.target.value }))}
                  placeholder={L.custom}
                  className="mt-1.5 h-8 w-full rounded-lg bg-white/[0.06] px-2.5 text-[13px] text-ink-100 outline-none placeholder:text-ink-500"
                />
              )}
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2">
          {waiting > 0 && <span className="text-[12px] text-ink-500">{waiting > 0 ? `+${waiting}` : ""}</span>}
          <div className="ml-auto flex gap-2">
            <button onClick={send} className="h-9 rounded-xl bg-accent px-5 text-[13px] font-medium text-canvas transition-[filter] hover:brightness-110">
              {L.send}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
