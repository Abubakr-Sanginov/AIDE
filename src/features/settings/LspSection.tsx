import { isRuLike } from "@/i18n/ruLike";
import { useEffect, useState } from "react";
import { Check, Copy, RefreshCw } from "lucide-react";
import { useI18n } from "@/i18n";
import { Btn, Row, Section } from "@/features/settings/SettingsPanel";
import { lspApi, type LspServerInfo } from "@/api/lsp";
import { useLsp } from "@/features/lsp/client";

const TEXT = {
  en: {
    title: "Language servers",
    enable: "Language servers in the editor",
    enableHint: "Completion by types, hover docs, go to definition (F12), references (Shift+F12), rename (F2), format (Shift+Alt+F) and errors right in the code. The agent sees the same errors.",
    installed: "Installed",
    running: "Running",
    starting: "Starting…",
    missing: "Not installed. Install with:",
    error: "Error",
    refresh: "Check again",
    copy: "Copy command",
    copied: "Copied",
    note: "AIDE only starts servers installed on this computer (PATH, ~/.cargo/bin, global npm, ~/go/bin) — never programs from the project folder.",
  },
  ru: {
    title: "Языковые серверы",
    enable: "Языковые серверы в редакторе",
    enableHint: "Подсказки по типам, описание при наведении, переход к определению (F12), ссылки (Shift+F12), переименование (F2), форматирование (Shift+Alt+F) и ошибки прямо в коде. Те же ошибки видит агент.",
    installed: "Установлен",
    running: "Работает",
    starting: "Запускается…",
    missing: "Не установлен. Установить:",
    error: "Ошибка",
    refresh: "Проверить снова",
    copy: "Скопировать команду",
    copied: "Скопировано",
    note: "AIDE запускает только серверы, установленные на этом компьютере (PATH, ~/.cargo/bin, глобальный npm, ~/go/bin), — никогда программы из папки проекта.",
  },
  tg: {
    title: "Серверҳои забон",
    enable: "Серверҳои забон дар муҳаррир",
    enableHint: "Пешниҳодҳо аз рӯи типҳо, тавсиф ҳангоми нишон додан, гузариш ба таъриф (F12), истинодҳо (Shift+F12), иваз кардани ном (F2), форматкунӣ (Shift+Alt+F) ва хатоҳо бевосита дар код. Ҳамин хатоҳоро агент мебинад.",
    installed: "Насб шудааст",
    running: "Кор мекунад",
    starting: "Оғоз мешавад…",
    missing: "Насб нашудааст. Насб кардан:",
    error: "Хато",
    refresh: "Аз нав санҷидан",
    copy: "Нусхабардории фармон",
    copied: "Нусха шуд",
    note: "AIDE танҳо серверҳоеро оғоз мекунад, ки дар ин компютер насб шудаанд (PATH, ~/.cargo/bin, npm-и глобалӣ, ~/go/bin), — ҳеҷ гоҳ барномаҳоро аз ҷузвдони лоиҳа.",
  },
};

function Switch({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
      className={"relative h-6 w-11 shrink-0 rounded-full transition-colors " + (on ? "bg-ink-100" : "bg-white/[0.14]")}
    >
      <span className={"absolute top-0.5 size-5 rounded-full transition-all " + (on ? "left-[22px] bg-canvas" : "left-0.5 bg-ink-300")} />
    </button>
  );
}

function CopyCmd({ cmd, L }: { cmd: string; L: (typeof TEXT)["en"] }) {
  const [done, setDone] = useState(false);
  return (
    <div className="mt-1.5 flex items-center gap-1.5">
      <code className="min-w-0 flex-1 truncate rounded-md bg-canvas px-2 py-1 font-mono text-[12px] text-ink-200">{cmd}</code>
      <Btn
        variant="ghost"
        className="!h-7 !px-2"
        title={done ? L.copied : L.copy}
        aria-label={done ? L.copied : L.copy}
        onClick={() => {
          void navigator.clipboard.writeText(cmd).then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          });
        }}
      >
        {done ? <Check size={14} /> : <Copy size={14} />}
      </Btn>
    </div>
  );
}

export function LspSection() {
  const { lang } = useI18n();
  const L = lang === "tg" ? TEXT.tg : isRuLike(lang) ? TEXT.ru : TEXT.en;
  const enabled = useLsp((s) => s.enabled);
  const status = useLsp((s) => s.status);
  const [servers, setServers] = useState<LspServerInfo[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    void lspApi
      .servers()
      .then(setServers)
      .catch(() => setServers([]))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);
  // Running state changes while the page is open.
  useEffect(() => {
    if (servers) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return (
    <>
      <Section title={L.title}>
        <Row title={L.enable} hint={L.enableHint}>
          <div className="flex justify-end">
            <Switch on={enabled} onChange={() => useLsp.getState().setEnabled(!enabled)} label={L.enable} />
          </div>
        </Row>
        {(servers ?? []).map((s) => {
          const st = status[s.id];
          const state = s.command
            ? st?.state === "error"
              ? `${L.error}: ${st.message}`
              : st?.state === "starting"
                ? L.starting
                : s.running
                  ? L.running
                  : L.installed
            : null;
          return (
            <Row
              key={s.id}
              title={s.name}
              hint={
                <>
                  <span className="font-mono text-[11.5px] text-ink-500">.{s.extensions.join(" .")}</span>
                  {s.command ? (
                    <div className={"mt-1 break-words " + (st?.state === "error" ? "text-red-300" : "text-ink-300")}>
                      {state}
                      <div className="truncate font-mono text-[11.5px] text-ink-500" title={s.command}>{s.command}</div>
                    </div>
                  ) : (
                    <div className="mt-1">
                      {L.missing}
                      <CopyCmd cmd={s.install} L={L} />
                    </div>
                  )}
                </>
              }
            >
              <div className="flex justify-end">
                <span
                  aria-hidden
                  className={
                    "mt-1 size-2.5 rounded-full " +
                    (!s.command ? "bg-white/15" : st?.state === "error" ? "bg-red-400" : s.running ? "bg-teal-300" : "bg-ink-500")
                  }
                />
              </div>
            </Row>
          );
        })}
      </Section>
      <div className="-mt-5 mb-8 flex items-center justify-between gap-4 px-1">
        <p className="text-[12.5px] leading-5 text-ink-500">{L.note}</p>
        <Btn variant="ghost" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          {L.refresh}
        </Btn>
      </div>
    </>
  );
}
