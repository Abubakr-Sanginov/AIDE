import { isRuLike } from "@/i18n/ruLike";
import { useState } from "react";
import { useI18n } from "@/i18n";
import { Btn, Row, Section, inputClass } from "@/features/settings/SettingsPanel";
import { Switch } from "@/ui/Switch";
import { testNotification } from "@/lib/notify";
import { loadPrefs, savePrefs, type NoticeKindId, type NotifyPrefs } from "@/lib/notifyPrefs";

const TEXT = {
  en: {
    title: "Notifications",
    events: "What to tell me about",
    done: "The agent finished",
    error: "An error",
    question: "The agent asks a question",
    permission: "The agent needs permission",
    channels: "When I am in another window",
    system: "System notification",
    systemHint: "A Windows notification. Appears only while AIDE is not in focus.",
    sound: "Sound",
    quiet: "Quiet hours",
    quietHint: "No system notifications and no sound. Messages inside the AIDE window still appear.",
    from: "From",
    to: "To",
    test: "Send a test",
    testTitle: "AIDE test",
    testBody: "If you can read this, notifications work.",
  },
  ru: {
    title: "Уведомления",
    events: "О чём сообщать",
    done: "Агент закончил работу",
    error: "Ошибка",
    question: "Агент задаёт вопрос",
    permission: "Агенту нужно разрешение",
    channels: "Когда я в другом окне",
    system: "Системное уведомление",
    systemHint: "Уведомление Windows. Появляется, только когда AIDE не в фокусе.",
    sound: "Звук",
    quiet: "Тихие часы",
    quietHint: "Без системных уведомлений и звука. Сообщения внутри окна AIDE всё равно появляются.",
    from: "С",
    to: "До",
    test: "Отправить пробное",
    testTitle: "Проверка AIDE",
    testBody: "Если вы это читаете, уведомления работают.",
  },
  tg: {
    title: "Огоҳиномаҳо",
    events: "Дар бораи чӣ хабар диҳем",
    done: "Агент кор ба анҷом расонд",
    error: "Хато",
    question: "Агент савол медиҳад",
    permission: "Агент иҷозат даркор дорад",
    channels: "Вақте ки ман дар равзанаи дигарам",
    system: "Огоҳиномаи система",
    systemHint: "Огоҳиномаи Windows. Танҳо вақте пайдо мешавад, ки AIDE дар фокус нест.",
    sound: "Овоз",
    quiet: "Соатҳои хомӯшӣ",
    quietHint: "Бе огоҳиномаи система ва бе овоз. Паёмҳо дар дохили равзанаи AIDE боз ҳам пайдо мешаванд.",
    from: "Аз",
    to: "То",
    test: "Фиристодани санҷишӣ",
    testTitle: "Санҷиши AIDE",
    testBody: "Агар инро мехонед, огоҳиномаҳо кор мекунанд.",
  },
};

const KINDS: NoticeKindId[] = ["done", "error", "question", "permission"];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

export function NotificationsSection() {
  const { lang } = useI18n();
  const L = lang === "tg" ? TEXT.tg : isRuLike(lang) ? TEXT.ru : TEXT.en;
  const [prefs, setPrefs] = useState<NotifyPrefs>(loadPrefs);
  const update = (next: NotifyPrefs) => {
    setPrefs(next);
    savePrefs(next);
  };

  return (
    <>
      <Section title={L.events}>
        {KINDS.map((k) => (
          <Row key={k} title={L[k]}>
            <div className="flex justify-end">
              <Switch on={prefs.kinds[k]} onChange={() => update({ ...prefs, kinds: { ...prefs.kinds, [k]: !prefs.kinds[k] } })} label={L[k]} />
            </div>
          </Row>
        ))}
      </Section>

      <Section title={L.channels}>
        <Row title={L.system} hint={L.systemHint}>
          <div className="flex justify-end">
            <Switch on={prefs.system} onChange={() => update({ ...prefs, system: !prefs.system })} label={L.system} />
          </div>
        </Row>
        <Row title={L.sound}>
          <div className="flex justify-end">
            <Switch on={prefs.sound} onChange={() => update({ ...prefs, sound: !prefs.sound })} label={L.sound} />
          </div>
        </Row>
        <Row title={L.quiet} hint={L.quietHint}>
          <div className="space-y-2">
            <div className="flex justify-end">
              <Switch on={prefs.quiet} onChange={() => update({ ...prefs, quiet: !prefs.quiet })} label={L.quiet} />
            </div>
            {prefs.quiet && (
              <div className="flex items-center justify-end gap-2 text-[13px] text-ink-300">
                <label className="flex items-center gap-1.5">
                  {L.from}
                  <select aria-label={`${L.quiet}: ${L.from}`} value={prefs.quietFrom} onChange={(e) => update({ ...prefs, quietFrom: Number(e.target.value) })} className={inputClass + " !w-auto"}>
                    {HOURS.map((h) => (
                      <option key={h} value={h}>
                        {hh(h)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1.5">
                  {L.to}
                  <select aria-label={`${L.quiet}: ${L.to}`} value={prefs.quietTo} onChange={(e) => update({ ...prefs, quietTo: Number(e.target.value) })} className={inputClass + " !w-auto"}>
                    {HOURS.map((h) => (
                      <option key={h} value={h}>
                        {hh(h)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>
        </Row>
        <Row title={L.test}>
          <div className="flex justify-end">
            <Btn onClick={() => void testNotification(L.testTitle, L.testBody)}>{L.test}</Btn>
          </div>
        </Row>
      </Section>
    </>
  );
}
