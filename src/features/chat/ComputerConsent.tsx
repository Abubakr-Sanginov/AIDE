import { useEffect, useRef } from "react";
import { Monitor } from "lucide-react";
import { rt } from "@/i18n/tgMap";
import { isRuLike } from "@/i18n/ruLike";
import { useI18n } from "@/i18n";

const POINTS: { ru: string; en: string }[] = [
  { ru: "Агент видит весь ваш экран. Снимки экрана уходят провайдеру модели, которую вы выбрали: закройте то, что не должно попасть на снимок (пароли, переписки, банк).", en: "The agent sees your whole screen. Screenshots go to the provider of the model you picked: close anything that must not appear in them (passwords, chats, banking)." },
  { ru: "Он кликает мышью и печатает на клавиатуре в других программах: например, проверяет бота в Telegram или ваше приложение.", en: "It clicks and types in other programs, for example to test a Telegram bot or your app." },
  { ru: "Окно самого AIDE агент не трогает: клики по нему и ввод при фокусе на AIDE отклоняются.", en: "The agent never operates AIDE's own window: clicks on it and typing while AIDE is in focus are refused." },
  { ru: "Остановить сразу: кнопка «Стоп» или мышь в левый верхний угол экрана.", en: "Stop at once: the Stop button, or move the mouse to the top-left corner of the screen." },
  { ru: "Рекомендуем режим разрешений «Спрашивать»: тогда каждый клик и ввод вы подтверждаете. В режиме «Свобода» подтверждения нет, кроме запуска программ и ссылок.", en: "We recommend the “Ask” permission mode: you confirm every click and every typing. In “Full” mode there are no confirmations, except for launching programs and links." },
  { ru: "Текст на экране агент считает данными, а не командами, но чужой текст может его запутать. Не оставляйте его надолго без присмотра.", en: "The agent treats on-screen text as data, not commands, but other people's text can still confuse it. Do not leave it unattended for long." },
];

export function ComputerConsent({ onAccept, onCancel }: { onAccept: () => void; onCancel: () => void }) {
  const { lang } = useI18n();
  const ru = isRuLike(lang);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const title = ru ? rt("Управление компьютером") : "Computer control";
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div role="dialog" aria-modal="true" aria-label={title} className="aide-pop max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line-strong bg-overlay p-5 shadow-2xl shadow-black/60">
        <div className="mb-3 flex items-center gap-2 text-[15px] font-medium text-ink-50">
          <Monitor size={18} className="text-amber-300" />
          {title}
        </div>
        <p className="mb-2 text-[13px] leading-5 text-ink-200">{ru ? rt("Режим «Компьютер» даёт агенту управлять этим компьютером. Прежде чем включить, прочитайте:") : "Computer mode lets the agent control this computer. Before you turn it on, please read:"}</p>
        <ul className="mb-4 list-disc space-y-1.5 pl-5 text-[12.5px] leading-5 text-ink-300">
          {POINTS.map((p) => (
            <li key={p.en}>{ru ? rt(p.ru) : p.en}</li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <button ref={cancelRef} type="button" onClick={onCancel} className="h-8 rounded-lg bg-white/[0.07] px-3 text-[13px] text-ink-100 hover:bg-white/[0.12]">
            {ru ? rt("Отмена") : "Cancel"}
          </button>
          <button type="button" onClick={onAccept} className="h-8 rounded-lg bg-ink-100 px-3 text-[13px] font-medium text-canvas hover:bg-white">
            {ru ? rt("Понятно, включить") : "Got it, turn on"}
          </button>
        </div>
      </div>
    </div>
  );
}
