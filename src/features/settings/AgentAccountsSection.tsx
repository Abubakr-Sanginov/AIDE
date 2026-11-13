import { isRuLike } from "@/i18n/ruLike";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { useI18n } from "@/i18n";
import { Btn, Row, Section } from "@/features/settings/SettingsPanel";
import { BLOCKED_AGENTS, accountsApi, type AgentAccount } from "@/api/accounts";
import { ConnectAgentKey } from "@/features/settings/ConnectAgentKey";

const TEXT = {
  en: {
    title: "AI agents on this computer",
    intro:
      "AIDE looks for AI agents installed here (Claude Code, Codex, Gemini CLI, Copilot, Cursor and others, including ones it has never seen) and shows the plan and account each is signed in with. It reads only local sign-in files: tokens and keys are never shown or sent anywhere, and the AI model does not see this page.",
    scan: "Scan again",
    scanning: "Scanning…",
    found: (n: number) => `Found: ${n}`,
    none: "No AI agents found.",
    auto: "found automatically",
    plan: "Plan",
    noPlan: "plan not in the files",
    signedOut: "not signed in",
    signedIn: "signed in",
    tokenUntil: "token until",
    tokenOld: "token is old (renews when the agent starts)",
    failed: "Could not scan:",
    hintNoPlan: "The agent is signed in, but its files do not say which plan it is.",
    connect: "Use its key in AIDE",
    showMore: (n: number) => `Show ${n} more without a sign-in found`,
    hideMore: "Hide them",
    locked: "its sign-in only works inside its own app",
  },
  ru: {
    title: "ИИ-агенты на этом компьютере",
    intro:
      "AIDE ищет установленных здесь ИИ-агентов (Claude Code, Codex, Gemini CLI, Copilot, Cursor и другие, в том числе незнакомые) и показывает, в каком аккаунте и на каком тарифе каждый из них. Читаются только локальные файлы входа: токены и ключи не показываются и никуда не отправляются, а модель ИИ эту страницу не видит.",
    scan: "Искать заново",
    scanning: "Ищу…",
    found: (n: number) => `Найдено: ${n}`,
    none: "ИИ-агентов не найдено.",
    auto: "найден автоматически",
    plan: "Тариф",
    noPlan: "тариф в файлах не указан",
    signedOut: "вход не найден",
    signedIn: "вход есть",
    tokenUntil: "токен до",
    tokenOld: "токен устарел (обновится при запуске агента)",
    failed: "Не удалось проверить:",
    hintNoPlan: "Агент вошёл в аккаунт, но в его файлах не написано, какой это тариф.",
    connect: "Использовать его ключ в AIDE",
    showMore: (n: number) => `Показать ещё ${n} без найденного входа`,
    hideMore: "Скрыть их",
    locked: "его вход работает только в его приложении",
  },
  tg: {
    title: "Агентҳои ИИ дар ин компютер",
    intro:
      "AIDE агентҳои ИИ-и дар ин ҷо насбшударо (Claude Code, Codex, Gemini CLI, Copilot, Cursor ва дигарон, аз ҷумла ношиносҳоро) меҷӯяд ва нишон медиҳад, ки ҳар кадом дар кадом ҳисоб ва бо кадом тариф аст. Танҳо файлҳои маҳаллии воридшавӣ хонда мешаванд: токенҳо ва калидҳо нишон дода намешаванд ва ба ҷое фиристода намешаванд, модели ИИ ин саҳифаро намебинад.",
    scan: "Аз нав ҷустан",
    scanning: "Меҷӯям…",
    found: (n: number) => `Ёфт шуд: ${n}`,
    none: "Агенти ИИ ёфт нашуд.",
    auto: "худкор ёфт шуд",
    plan: "Тариф",
    noPlan: "тариф дар файлҳо нест",
    signedOut: "воридшавӣ ёфт нашуд",
    signedIn: "воридшавӣ ҳаст",
    tokenUntil: "токен то",
    tokenOld: "токен кӯҳна шудааст (ҳангоми оғози агент нав мешавад)",
    failed: "Санҷиш нашуд:",
    hintNoPlan: "Агент ворид шудааст, аммо дар файлҳояш тариф навишта нашудааст.",
    connect: "Калиди ӯро дар AIDE истифода бурдан",
    showMore: (n: number) => `Нишон додани ${n} дигар бе воридшавии ёфтшуда`,
    hideMore: "Пинҳон кардан",
    locked: "воридшавии ӯ танҳо дар барномаи худаш кор мекунад",
  },
};

function Badge({ tone, children }: { tone: "ok" | "warn" | "dim"; children: React.ReactNode }) {
  const cls = { ok: "bg-teal-300/10 text-teal-200", warn: "bg-amber-300/10 text-amber-200", dim: "bg-white/[0.06] text-ink-300" }[tone];
  return <span className={"rounded px-1.5 py-px text-[11px] " + cls}>{children}</span>;
}

export function AgentAccountsSection() {
  const { lang } = useI18n();
  const L = lang === "tg" ? TEXT.tg : isRuLike(lang) ? TEXT.ru : TEXT.en;
  const [list, setList] = useState<AgentAccount[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState<AgentAccount | null>(null);
  const [notice, setNotice] = useState("");
  const [all, setAll] = useState(false);
  const seq = useRef(0);

  const scan = useCallback(() => {
    const mine = ++seq.current;
    setBusy(true);
    setError("");
    void accountsApi
      .scan()
      .then((r) => mine === seq.current && setList(r))
      .catch((e) => mine === seq.current && setError(String(e)))
      .finally(() => mine === seq.current && setBusy(false));
  }, []);
  useEffect(scan, [scan]);

  const date = (ms: number) => new Date(ms).toLocaleDateString(lang === "tg" ? "ru-RU" : lang);

  return (
    <Section title={L.title}>
      <Row title={list ? L.found(list.length) : L.title} hint={L.intro}>
        <div className="flex justify-end">
          <Btn onClick={scan} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {busy ? L.scanning : L.scan}
          </Btn>
        </div>
      </Row>
      {notice && <Row title={<span role="status" className="text-teal-200">{notice}</span>} />}
      {error && (
        <Row title={<span className="text-red-400">{L.failed}</span>} hint={<span role="alert" className="break-words text-red-300">{error}</span>} />
      )}
      {list && list.length === 0 && <Row title={L.none} />}
      {(all ? list : list?.filter((a) => a.known || a.signed_in || a.plan))?.map((a) => {
        const details = [a.account, ...a.facts.map(([k, v]) => `${k}: ${v}`)].filter(Boolean);
        return (
          <Row
            key={a.id}
            title={
              <span className="flex flex-wrap items-center gap-2">
                <span>{a.name}</span>
                {!a.known && <Badge tone="dim">{L.auto}</Badge>}
                <Badge tone={a.signed_in ? "ok" : "dim"}>{a.signed_in ? L.signedIn : L.signedOut}</Badge>
              </span>
            }
            hint={
              <span className="block space-y-0.5">
                <span className="block break-all font-mono text-[11.5px] text-ink-500">{a.location}</span>
                {details.length > 0 && <span className="block break-words">{details.join(" · ")}</span>}
                {a.expires_at != null && (
                  <span className="block">{a.expires_at < Date.now() ? L.tokenOld : `${L.tokenUntil} ${date(a.expires_at)}`}</span>
                )}
                {a.signed_in && !a.plan && <span className="block">{L.hintNoPlan}</span>}
              </span>
            }
          >
            <div className="flex flex-col items-end gap-1.5">
              {a.signed_in &&
                (BLOCKED_AGENTS.includes(a.id) ? (
                  <span className="max-w-[260px] text-right text-[11.5px] text-ink-500">{L.locked}</span>
                ) : (
                  <Btn onClick={() => setConnecting(a)}>{L.connect}</Btn>
                ))}
              {a.plan ? (
                <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-100">
                  <span className="text-ink-400">{L.plan}:</span>
                  <Badge tone="ok">{a.plan}</Badge>
                </span>
              ) : a.signed_in ? (
                <Badge tone="warn">{L.noPlan}</Badge>
              ) : null}
            </div>
          </Row>
        );
      })}
      {list && list.some((a) => !(a.known || a.signed_in || a.plan)) && (
        <Row title={<span className="text-[13px] font-normal text-ink-400">{all ? "" : L.showMore(list.filter((a) => !(a.known || a.signed_in || a.plan)).length)}</span>}>
          <div className="flex justify-end">
            <Btn onClick={() => setAll((v) => !v)}>{all ? L.hideMore : L.showMore(list.filter((a) => !(a.known || a.signed_in || a.plan)).length)}</Btn>
          </div>
        </Row>
      )}
      {connecting && (
        <ConnectAgentKey
          agent={connecting}
          onClose={() => setConnecting(null)}
          onDone={(m) => {
            setConnecting(null);
            setNotice(m);
          }}
        />
      )}
    </Section>
  );
}
