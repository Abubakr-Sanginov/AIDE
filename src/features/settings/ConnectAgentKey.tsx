import { isRuLike } from "@/i18n/ruLike";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useI18n } from "@/i18n";
import { accountsApi, type AgentAccount, type KeyCandidate } from "@/api/accounts";
import { useAi } from "@/stores/ai";
import { acceptableUrl, providerIdFor } from "@/lib/agentKeys";
import { isLoopbackUrl } from "@/lib/localProviders";

// Connect a key that another agent stored as an AI provider in AIDE. The key never reaches this code: the backend reads it
// from the agent's file and puts it straight into the Windows credential store. Here the person picks which key, where it is
// sent (shown plainly) and confirms.

const TEXT = {
  en: {
    title: "Connect as a provider",
    loading: "Looking for keys…",
    none: "No keys or tokens that can be used were found in this agent's files.",
    pick: "Which key to use",
    blocked: "cannot be used",
    name: "Provider name",
    protocol: "Protocol",
    url: "API address",
    urlHint: "Where the key will be sent. Use the service's own https address.",
    sendTo: (host: string) => `The key will be sent to: ${host}`,
    proxy: "This is a local address: the agent's own helper program. It works only while that agent is running, and its port and key may change after it restarts (then connect again). It uses the agent's subscription, and the agent itself may refuse requests that do not come from its own app.",
    risk: "Some services forbid using a subscription token outside their own app, and the account may be blocked. The key is taken from this agent's files and stored in the Windows credential store; the agent itself is not changed.",
    agree: "I understand and want to connect it",
    connect: "Connect",
    cancel: "Cancel",
    badUrl: "Enter an https address (or http://localhost for a program on this computer).",
    failed: "Could not connect:",
    done: "Connected. Pick a model in the chat.",
  },
  ru: {
    title: "Подключить как провайдера",
    loading: "Ищу ключи…",
    none: "В файлах этого агента не нашлось ключей или токенов, которые можно использовать.",
    pick: "Какой ключ использовать",
    blocked: "использовать нельзя",
    name: "Название провайдера",
    protocol: "Протокол",
    url: "Адрес API",
    urlHint: "Куда будет отправляться ключ. Укажите собственный https-адрес сервиса.",
    sendTo: (host: string) => `Ключ будет отправляться на: ${host}`,
    proxy: "Это локальный адрес: вспомогательная программа самого агента. Она работает, только пока агент запущен, а порт и ключ после его перезапуска могут смениться (тогда подключите заново). Используется подписка агента, и сам агент может отказывать запросам не из своего приложения.",
    risk: "Некоторые сервисы запрещают использовать токен подписки вне их приложения, аккаунт могут заблокировать. Ключ берётся из файлов этого агента и сохраняется в хранилище ключей Windows; сам агент не меняется.",
    agree: "Понимаю и хочу подключить",
    connect: "Подключить",
    cancel: "Отмена",
    badUrl: "Введите адрес с https (или http://localhost для программы на этом компьютере).",
    failed: "Не удалось подключить:",
    done: "Подключено. Выберите модель в чате.",
  },
  tg: {
    title: "Ҳамчун провайдер пайваст кардан",
    loading: "Калидҳоро меҷӯям…",
    none: "Дар файлҳои ин агент калид ё токени истифодашаванда ёфт нашуд.",
    pick: "Кадом калидро истифода барем",
    blocked: "истифода намешавад",
    name: "Номи провайдер",
    protocol: "Протокол",
    url: "Суроғаи API",
    urlHint: "Калид ба куҷо фиристода мешавад. Суроғаи https-и худи сервисро нависед.",
    sendTo: (host: string) => `Калид ба ин ҷо фиристода мешавад: ${host}`,
    proxy: "Ин суроғаи маҳаллӣ аст: барномаи ёрирасони худи агент. Он танҳо вақте кор мекунад, ки агент фаъол аст, ва порт ва калид пас аз аз нав оғоз шудан тағйир ёфта метавонанд (он гоҳ аз нав пайваст кунед). Обунаи агент истифода мешавад ва худи агент метавонад дархостҳоро аз барномаи дигар рад кунад.",
    risk: "Баъзе сервисҳо истифодаи токени обунаро берун аз барномаи худашон манъ мекунанд ва ҳисобро масдуд карда метавонанд. Калид аз файлҳои ин агент гирифта мешавад ва дар захираи калидҳои Windows нигоҳ дошта мешавад; худи агент тағйир намеёбад.",
    agree: "Мефаҳмам ва мехоҳам пайваст кунам",
    connect: "Пайваст кардан",
    cancel: "Бекор",
    badUrl: "Суроғаи https нависед (ё http://localhost барои барнома дар ин компютер).",
    failed: "Пайваст нашуд:",
    done: "Пайваст шуд. Дар чат модел интихоб кунед.",
  },
};

export function ConnectAgentKey({ agent, onClose, onDone }: { agent: AgentAccount; onClose: () => void; onDone: (message: string) => void }) {
  const { lang } = useI18n();
  const L = lang === "tg" ? TEXT.tg : isRuLike(lang) ? TEXT.ru : TEXT.en;
  const providers = useAi((s) => s.providers);
  const [list, setList] = useState<KeyCandidate[] | null>(null);
  const [error, setError] = useState("");
  const [choice, setChoice] = useState("");
  const [name, setName] = useState(agent.name);
  const [kind, setKind] = useState<KeyCandidate["kind"]>("openai");
  const [url, setUrl] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void accountsApi
      .keys(agent.id)
      .then((r) => alive && setList(r))
      .catch((e) => alive && (setList([]), setError(String(e))));
    return () => {
      alive = false;
    };
  }, [agent.id]);

  const pick = (c: KeyCandidate) => {
    if (c.blocked) return;
    setChoice(c.id);
    setKind(c.kind);
    setUrl(c.base_url ?? "");
  };
  const chosen = list?.find((c) => c.id === choice);
  const parsed = acceptableUrl(url);
  const ready = !!chosen && !!parsed && agree && name.trim().length > 0 && !busy;

  const connect = async () => {
    if (!chosen || !parsed) return;
    setBusy(true);
    setError("");
    try {
      const id = providerIdFor(agent.id, providers.map((p) => p.id));
      await accountsApi.importKey(chosen.id, id);
      // The agent's helper program often cannot list models: take the list the agent wrote next to the key (best effort).
      const models = await accountsApi.models(chosen.id).catch(() => [] as string[]);
      useAi.getState().registerImportedProvider({ id, name: name.trim(), kind, baseUrl: parsed.href, custom: true, ...(models.length > 0 ? { models } : {}) });
      onDone(L.done);
    } catch (e) {
      setError(`${L.failed} ${String(e)}`);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${L.title}: ${agent.name}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-xl border border-ink-700 bg-ink-900 p-4 text-[13px] text-ink-200 shadow-2xl"
      >
        <div className="text-[14px] font-semibold text-ink-50">
          {L.title}: {agent.name}
        </div>
        {!list && (
          <div className="flex items-center gap-2 text-ink-400">
            <Loader2 size={14} className="animate-spin" />
            {L.loading}
          </div>
        )}
        {list && list.length === 0 && <p className="text-ink-400">{error || L.none}</p>}
        {list && list.length > 0 && (
          <>
            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-ink-400">{L.pick}</legend>
              {list.map((c) => (
                <label
                  key={c.id}
                  className={"flex items-start gap-2 rounded-lg border px-2.5 py-2 " + (c.blocked ? "border-ink-800 opacity-60" : choice === c.id ? "border-teal-300/50 bg-teal-300/5" : "cursor-pointer border-ink-700 hover:bg-white/[0.04]")}
                >
                  <input type="radio" name="key" disabled={!!c.blocked} checked={choice === c.id} onChange={() => pick(c)} className="mt-1" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-[12.5px]">{c.field}</span>
                    <span className="block break-all text-[11.5px] text-ink-500">
                      {c.file} · {c.preview}
                    </span>
                    {c.blocked && <span className="block text-[12px] text-amber-300">{L.blocked}: {c.blocked}</span>}
                  </span>
                </label>
              ))}
            </fieldset>
            {chosen && (
              <div className="space-y-2">
                <label className="block">
                  <span className="text-ink-400">{L.name}</span>
                  <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className="mt-1 h-8 w-full rounded-lg bg-white/[0.06] px-2.5 text-ink-100 outline-none focus:bg-white/[0.09]" />
                </label>
                <label className="block">
                  <span className="text-ink-400">{L.protocol}</span>
                  <select value={kind} onChange={(e) => setKind(e.target.value as KeyCandidate["kind"])} className="mt-1 h-8 w-full rounded-lg bg-white/[0.06] px-2 text-ink-100 outline-none">
                    <option value="openai">OpenAI-compatible</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="google">Google</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-ink-400">{L.url}</span>
                  <input value={url} spellCheck={false} placeholder="https://api.example.com/v1" onChange={(e) => setUrl(e.target.value)} aria-invalid={!!url && !parsed} className="mt-1 h-8 w-full rounded-lg bg-white/[0.06] px-2.5 font-mono text-[12.5px] text-ink-100 outline-none focus:bg-white/[0.09]" />
                  <span className="mt-0.5 block text-[12px] text-ink-500">{L.urlHint}</span>
                </label>
                {url && !parsed && <p role="alert" className="text-red-300">{L.badUrl}</p>}
                {parsed && <p className="rounded-lg bg-amber-300/10 px-2.5 py-1.5 text-amber-200">{L.sendTo(parsed.host)}</p>}
                {parsed && isLoopbackUrl(parsed.href) && <p className="text-[12.5px] leading-5 text-ink-300">{L.proxy}</p>}
                <p className="text-[12.5px] leading-5 text-ink-400">{L.risk}</p>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                  {L.agree}
                </label>
              </div>
            )}
            {error && <p role="alert" className="break-words text-red-300">{error}</p>}
          </>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-md bg-white/[0.08] px-3 py-1.5 text-ink-100 hover:bg-white/[0.14]">
            {L.cancel}
          </button>
          <button
            disabled={!ready}
            onClick={() => void connect()}
            className="inline-flex items-center gap-1.5 rounded-md bg-ink-100 px-3 py-1.5 font-medium text-canvas hover:bg-white disabled:opacity-40"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {L.connect}
          </button>
        </div>
      </div>
    </div>
  );
}
