import { isRuLike } from "@/i18n/ruLike";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useI18n } from "@/i18n";
import { Btn, Row, Section } from "@/features/settings/SettingsPanel";
import { checkForUpdate, currentVersion, installUpdate, type UpdateInfo } from "@/lib/updater";

const TEXT = {
  en: {
    title: "Updates",
    version: "Version",
    check: "Check for updates",
    checking: "Checking…",
    latest: "You have the latest version.",
    available: (v: string) => `Version ${v} is available.`,
    install: "Install and restart",
    installing: "Downloading…",
    hint: "Updates come from the project's GitHub releases and are installed only if they are signed with AIDE's key. AIDE restarts to finish the update.",
    failed: "Could not check:",
    dev: "Updates work in the installed app, not in development mode.",
    noRelease: "No published release found yet. Check again after the next release.",
    offline: "Could not reach GitHub. Check your internet connection.",
  },
  ru: {
    title: "Обновления",
    version: "Версия",
    check: "Проверить обновления",
    checking: "Проверяю…",
    latest: "У вас последняя версия.",
    available: (v: string) => `Доступна версия ${v}.`,
    install: "Установить и перезапустить",
    installing: "Скачиваю…",
    hint: "Обновления берутся из релизов проекта на GitHub и ставятся, только если подписаны ключом AIDE. Для установки AIDE перезапустится.",
    failed: "Не удалось проверить:",
    dev: "Обновления работают в установленном приложении, а не в режиме разработки.",
    noRelease: "Опубликованных релизов пока нет. Проверьте снова после следующего релиза.",
    offline: "Не удалось связаться с GitHub. Проверьте подключение к интернету.",
  },
  tg: {
    title: "Навсозиҳо",
    version: "Нусха",
    check: "Санҷиши навсозиҳо",
    checking: "Месанҷам…",
    latest: "Шумо нусхаи охиринро доред.",
    available: (v: string) => `Нусхаи ${v} дастрас аст.`,
    install: "Насб ва аз нав оғоз кардан",
    installing: "Зеркашӣ мекунам…",
    hint: "Навсозиҳо аз релизҳои лоиҳа дар GitHub гирифта мешаванд ва танҳо дар сурате насб мешаванд, ки бо калиди AIDE имзо шуда бошанд. Барои насб AIDE аз нав оғоз мешавад.",
    failed: "Санҷиш нашуд:",
    dev: "Навсозиҳо дар барномаи насбшуда кор мекунанд, на дар реҷаи таҳия.",
    noRelease: "Ҳоло релизи нашршуда нест. Пас аз релизи навбатӣ боз санҷед.",
    offline: "Бо GitHub пайваст шудан нашуд. Интернетро санҷед.",
  },
};

/** Turns the updater's technical errors into something a person can act on. */
export function explain(message: string, L: { noRelease: string; offline: string; failed: string }): string {
  if (/valid release json|404|not found/i.test(message)) return L.noRelease;
  if (/error sending request|dns|timed out|network|connect/i.test(message)) return L.offline;
  return `${L.failed} ${message}`;
}

export function UpdatesSection() {
  const { lang } = useI18n();
  const L = lang === "tg" ? TEXT.tg : isRuLike(lang) ? TEXT.ru : TEXT.en;
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<UpdateInfo | null>(null);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  useEffect(() => {
    void currentVersion().then(setVersion);
  }, []);

  const check = async () => {
    setBusy(true);
    setMessage("");
    setFound(null);
    const r = await checkForUpdate();
    setBusy(false);
    if (r.state === "available") setFound(r.info);
    else if (r.state === "none") setMessage(L.latest);
    else setMessage(import.meta.env.DEV ? L.dev : explain(r.message, L));
  };

  const install = async () => {
    setBusy(true);
    setProgress(0);
    try {
      await installUpdate((done, total) => setProgress(total ? Math.min(100, Math.round((done / total) * 100)) : null));
    } catch (e) {
      setMessage(`${L.failed} ${String(e).slice(0, 300)}`);
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <Section title={L.title}>
      <Row title={L.version} hint={L.hint}>
        <div className="flex justify-end font-mono text-[13px] text-ink-200">{version || "—"}</div>
      </Row>
      <Row
        title={found ? L.available(found.version) : L.check}
        hint={
          <span className="block whitespace-pre-wrap break-words" role="status">
            {found ? found.notes : message}
          </span>
        }
      >
        <div className="flex justify-end gap-2">
          {found ? (
            <Btn onClick={() => void install()} disabled={busy}>
              {busy && <Loader2 size={14} className="animate-spin" />}
              {busy ? `${L.installing}${progress != null ? ` ${progress}%` : ""}` : L.install}
            </Btn>
          ) : (
            <Btn onClick={() => void check()} disabled={busy}>
              {busy && <Loader2 size={14} className="animate-spin" />}
              {busy ? L.checking : L.check}
            </Btn>
          )}
        </div>
      </Row>
    </Section>
  );
}
