import { isRuLike } from "@/i18n/ruLike";
import { Mic } from "lucide-react";
import { useI18n } from "@/i18n";
import { useVoiceControl } from "@/features/voice/voiceControl";

/** A small badge while voice control listens, recognises or waits to send (the system tones and notifications cover the rest). */
export function VoiceIndicator() {
  const { lang } = useI18n();
  const phase = useVoiceControl((s) => s.phase);
  const text = useVoiceControl((s) => s.text);
  if (phase === "idle") return null;
  const ru = isRuLike(lang);
  const label =
    phase === "listening"
      ? ru ? "Слушаю…" : "Listening…"
      : phase === "working"
        ? ru ? "Распознаю…" : "Recognising…"
        : `${ru ? "Выполню через 3 с" : "Running in 3 s"}: «${text.slice(0, 80)}»`;
  return (
    <div
      role="status"
      className={
        "pointer-events-none fixed bottom-4 left-4 z-[140] flex max-w-[360px] items-center gap-2 rounded-full border border-line-strong bg-overlay px-3 py-2 text-[12.5px] text-ink-100 shadow-xl shadow-black/50 " +
        (phase === "listening" ? "aide-working" : "")
      }
    >
      <Mic size={14} className={phase === "listening" ? "text-red-400" : "text-teal-300"} />
      <span className="truncate">{label}</span>
    </div>
  );
}
