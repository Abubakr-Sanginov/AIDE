import { isRuLike } from "@/i18n/ruLike";
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useI18n } from "@/i18n";
import { Btn, Row, Section } from "@/features/settings/SettingsPanel";

interface Entry {
  ts: number;
  tool: string;
  summary: string;
  ok: boolean;
  note: string;
}

const TEXT = {
  en: {
    title: "Computer mode log",
    intro:
      "Every action of the agent in Computer mode (clicks, keys, windows, launches), when it happened and how it ended. Typed text is not recorded, only its length; links lose everything after “?”. Stored only on this computer, last 500 records.",
    refresh: "Refresh",
    clear: "Clear the log",
    empty: "No actions yet.",
    failed: "failed",
    ok: "ok",
    count: (n: number) => `Records: ${n}`,
    error: "Could not read the log:",
  },
  ru: {
    title: "Журнал режима «Компьютер»",
    intro:
      "Каждое действие агента в режиме «Компьютер» (клики, клавиши, окна, запуск программ): когда было и чем закончилось. Введённый текст не записывается, только его длина; у ссылок отбрасывается всё после «?». Хранится только на этом компьютере, последние 500 записей.",
    refresh: "Обновить",
    clear: "Очистить журнал",
    empty: "Действий пока не было.",
    failed: "не удалось",
    ok: "ок",
    count: (n: number) => `Записей: ${n}`,
    error: "Не удалось прочитать журнал:",
  },
  tg: {
    title: "Рӯзномаи реҷаи «Компютер»",
    intro:
      "Ҳар амали агент дар реҷаи «Компютер» (клик, тугмаҳо, равзанаҳо, оғози барномаҳо): кай буд ва чӣ тавр анҷом ёфт. Матни воридшуда сабт намешавад, танҳо дарозии он; дар суроғаҳо ҳама чиз пас аз «?» хориҷ карда мешавад. Танҳо дар ин компютер нигоҳ дошта мешавад, 500 сабти охирин.",
    refresh: "Нав кардан",
    clear: "Тоза кардани рӯзнома",
    empty: "Ҳоло амале нашудааст.",
    failed: "нашуд",
    ok: "хуб",
    count: (n: number) => `Сабтҳо: ${n}`,
    error: "Рӯзномаро хондан нашуд:",
  },
};

export function ComputerLogSection() {
  const { lang } = useI18n();
  const L = lang === "tg" ? TEXT.tg : isRuLike(lang) ? TEXT.ru : TEXT.en;
  const [list, setList] = useState<Entry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setBusy(true);
    setError("");
    void invoke<Entry[]>("computer_log_list", { limit: 200 })
      .then(setList)
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  }, []);
  useEffect(load, [load]);

  const clear = () => {
    void invoke("computer_log_clear")
      .then(() => setList([]))
      .catch((e) => setError(String(e)));
  };

  const when = (ts: number) => new Date(ts).toLocaleString(lang === "tg" ? "ru-RU" : lang);

  return (
    <Section title={L.title}>
      <Row title={list ? L.count(list.length) : L.title} hint={L.intro}>
        <div className="flex justify-end gap-2">
          <Btn onClick={load} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {L.refresh}
          </Btn>
          <Btn onClick={clear} disabled={!list || list.length === 0}>
            <Trash2 size={14} />
            {L.clear}
          </Btn>
        </div>
      </Row>
      {error && <Row title={<span role="alert" className="text-red-300">{L.error} {error}</span>} />}
      {list && list.length === 0 && <Row title={L.empty} />}
      {list?.map((e, i) => (
        <Row
          key={`${e.ts}-${i}`}
          title={<span className="break-words text-[13px] font-normal">{e.summary}</span>}
          hint={
            <span className="block break-words">
              <span className="font-mono">{e.tool}</span> · {when(e.ts)}
              {e.note && <span className="block text-red-300">{e.note}</span>}
            </span>
          }
        >
          <div className="flex justify-end">
            <span className={"rounded px-1.5 py-px text-[11px] " + (e.ok ? "bg-teal-300/10 text-teal-200" : "bg-red-400/10 text-red-300")}>{e.ok ? L.ok : L.failed}</span>
          </div>
        </Row>
      ))}
    </Section>
  );
}
