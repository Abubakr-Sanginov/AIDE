import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useI18n } from "@/i18n";
import { isRuLike } from "@/i18n/ruLike";
import { qoderApi, type QoderStatus } from "@/api/qoder";
import { qoderCommands, qoderStep } from "@/lib/qoderSetup";
import { Btn, Row, inputClass } from "@/features/settings/SettingsPanel";
import { useAi } from "@/stores/ai";

const TEXT = {
  en: {
    title: "Qoder subscription",
    how: "AIDE runs your own Qoder CLI, the way Qoder connects to other editors, and requests spend your plan's credits. AIDE does not read the Qoder app's sign-in.",
    desktop: "The Qoder app is installed, but other programs need the official Qoder CLI.",
    install: "1. Install Qoder CLI (run in a terminal, then press “Check again”):",
    found: "Qoder CLI found:",
    login: "Sign in once, in a terminal opened after the installation:",
    token: "Or save a personal access token (qoder.com/account/integrations)",
    tokenSaved: "Token saved. It is used instead of the CLI sign-in.",
    tokenEnv: "A token is set in QODER_PERSONAL_ACCESS_TOKEN.",
    save: "Save",
    remove: "Delete",
    refresh: "Check again",
    limits: "Chat, Plan and Agent work. Qoder uses its own tools and your rules from ~/.qoder; the project's .qoder settings and MCP servers are switched off. AIDE's undo does not cover its edits. Computer and 3D Studio modes need another provider.",
  },
  ru: {
    title: "Подписка Qoder",
    how: "AIDE запускает ваш Qoder CLI — так Qoder подключается к другим редакторам; запросы тратят кредиты вашего тарифа. Вход приложения Qoder AIDE не читает.",
    desktop: "Приложение Qoder установлено, но другим программам нужен официальный Qoder CLI.",
    install: "1. Установите Qoder CLI (выполните в терминале, затем нажмите «Проверить снова»):",
    found: "Qoder CLI найден:",
    login: "Один раз войдите (в терминале, открытом после установки):",
    token: "Или сохраните персональный токен (qoder.com/account/integrations)",
    tokenSaved: "Токен сохранён. Он используется вместо входа CLI.",
    tokenEnv: "Токен задан в переменной QODER_PERSONAL_ACCESS_TOKEN.",
    save: "Сохранить",
    remove: "Удалить",
    refresh: "Проверить снова",
    limits: "Работают «Чат», «План» и «Агент». Qoder пользуется своими инструментами и вашими правилами из ~/.qoder; настройки .qoder проекта и MCP-серверы отключены. Отмена изменений AIDE на его правки не действует. Для «Компьютера» и «Студии 3D» нужен другой провайдер.",
  },
};

export function QoderProviderRow() {
  const { lang } = useI18n();
  const L = isRuLike(lang) ? TEXT.ru : TEXT.en;
  const refreshKey = useAi((s) => s.refreshKey);
  const [status, setStatus] = useState<QoderStatus | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setStatus(await qoderApi.status());
    await refreshKey();
  }, [refreshKey]);
  useEffect(() => {
    void load().catch((e) => setError(String(e)));
  }, [load]);

  const run = (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    void fn()
      .then(load)
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  };

  const commands = qoderCommands(navigator.userAgent.includes("Windows"));
  const code = "block select-all break-all rounded-lg bg-ink-950/60 px-2.5 py-1.5 font-mono text-[12px] text-ink-200";

  return (
    <Row title={L.title} hint={L.how}>
      <div className="space-y-2 text-[12.5px] text-ink-300">
        {status && qoderStep(status) === "install" && (
          <>
            {status.desktop && <p className="text-amber-200">{L.desktop}</p>}
            <p>{L.install}</p>
            <code className={code}>{commands.install}</code>
          </>
        )}
        {status?.cli && (
          <p className="break-all text-teal-200">
            {L.found} {status.cli}
          </p>
        )}
        {status && (
          <>
            <p>{L.login}</p>
            <code className={code}>{commands.login}</code>
            <input
              type="password"
              value={token}
              autoComplete="off"
              aria-label={L.token}
              placeholder={L.token}
              onChange={(e) => setToken(e.target.value)}
              className={inputClass}
            />
            {status.token_saved && <p>{L.tokenSaved}</p>}
            {!status.token_saved && status.token_env && <p>{L.tokenEnv}</p>}
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <Btn
            variant="primary"
            disabled={busy || !token.trim()}
            onClick={() =>
              run(async () => {
                await qoderApi.setToken(token);
                setToken("");
              })
            }
          >
            {L.save}
          </Btn>
          {status?.token_saved && (
            <Btn variant="danger" disabled={busy} onClick={() => run(() => qoderApi.clearToken())}>
              {L.remove}
            </Btn>
          )}
          <Btn disabled={busy} onClick={() => run(async () => {})}>
            <RefreshCw size={13} />
            {L.refresh}
          </Btn>
        </div>
        {error && (
          <p role="alert" className="break-words text-red-400">
            {error}
          </p>
        )}
        <p className="text-ink-500">{L.limits}</p>
      </div>
    </Row>
  );
}
