import { isRuLike } from "@/i18n/ruLike";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, RefreshCw } from "lucide-react";
import { useI18n } from "@/i18n";
import { Btn, Row, Section, inputClass } from "@/features/settings/SettingsPanel";
import { Switch } from "@/ui/Switch";
import { localApi, type LocalServerStatus } from "@/api/local";
import { useAi } from "@/stores/ai";
import {
  LOCAL_DEFAULTS,
  formatContext,
  formatSize,
  canMakeVariant,
  isAideVariant,
  modelFit,
  sortLocalModels,
  type LocalModelInfo,
  type LocalServerId,
} from "@/lib/localProviders";

const TEXT = {
  en: {
    title: "Local models",
    intro: "Run models on this computer with Ollama or LM Studio: no API key, no internet, your code never leaves the machine. AIDE finds running servers by itself.",
    check: "Check again",
    checking: "Checking…",
    running: "Running",
    stopped: "Not running",
    models: "Models",
    noModels: "No models yet.",
    use: "Use",
    active: "In use",
    address: "Address",
    addressHint: "Another port? Only addresses on this computer are allowed.",
    save: "Save",
    invalid: "Enter an address on this computer, e.g. http://127.0.0.1:11434",
    startOllama: "Install Ollama (ollama.com), then start the app or run `ollama serve`. Get a model that supports tools, e.g. `ollama pull qwen2.5-coder:7b`.",
    startLm: "Open LM Studio → Developer → Start Server (port 1234), then load a model.",
    tools: "tools",
    noTools: "no tools",
    smallCtx: "small context",
    upTo: "up to",
    loaded: "loaded",
    compact: "Compact agent",
    compactHint: "Shorter instructions and only the core tools (files, search, terminal, errors, skills). Small models make fewer mistakes this way. Turn off for large models.",
    ctxNote: "The agent needs a context of at least 8K, better 16K+. Ollama: set OLLAMA_CONTEXT_LENGTH=16384 before starting it. LM Studio: raise “Context Length” when loading the model.",
    noToolsNote: "A model without tool support cannot edit files as an agent. It still works for chat and plan mode.",
    ctx16: "Context 16K",
    ctx16Why: "Ollama starts models with a 4K context by default, and the agent does not fit: the start of the conversation is silently dropped.",
    ctx16Ask: "Create a copy of this model with a 16K context? Nothing is downloaded: it shares the weights, takes almost no disk space and can be removed here. Uses more memory while running.",
    ctx16Do: "Create copy",
    cancel: "Cancel",
    creating: "Creating…",
    copyBadge: "AIDE copy",
    remove: "Remove copy",
    removeAsk: "Remove this copy? The original model stays.",
    removeDo: "Remove",
    failed: "Failed:",
  },
  ru: {
    title: "Локальные модели",
    intro: "Запускайте модели на этом компьютере через Ollama или LM Studio: без ключа API и интернета, ваш код не покидает машину. AIDE сама находит запущенные серверы.",
    check: "Проверить снова",
    checking: "Проверяю…",
    running: "Запущен",
    stopped: "Не запущен",
    models: "Моделей",
    noModels: "Моделей пока нет.",
    use: "Выбрать",
    active: "Выбрана",
    address: "Адрес",
    addressHint: "Другой порт? Разрешены только адреса на этом компьютере.",
    save: "Сохранить",
    invalid: "Укажите адрес на этом компьютере, например http://127.0.0.1:11434",
    startOllama: "Установите Ollama (ollama.com) и запустите приложение или команду `ollama serve`. Скачайте модель с поддержкой инструментов, например `ollama pull qwen2.5-coder:7b`.",
    startLm: "В LM Studio откройте Developer → Start Server (порт 1234) и загрузите модель.",
    tools: "инструменты",
    noTools: "нет инструментов",
    smallCtx: "мало контекста",
    upTo: "до",
    loaded: "загружена",
    compact: "Компактный агент",
    compactHint: "Короткие инструкции и только основные инструменты (файлы, поиск, терминал, ошибки, навыки). Небольшие модели так ошибаются реже. Для больших моделей можно отключить.",
    ctxNote: "Агенту нужен контекст от 8K, лучше 16K и больше. Ollama: задайте OLLAMA_CONTEXT_LENGTH=16384 до запуска. LM Studio: увеличьте «Context Length» при загрузке модели.",
    noToolsNote: "Модель без поддержки инструментов не может править файлы как агент. Для чата и режима «План» она подходит.",
    ctx16: "Контекст 16K",
    ctx16Why: "Ollama по умолчанию запускает модели с контекстом 4K, и агент в него не помещается: начало разговора молча отбрасывается.",
    ctx16Ask: "Создать копию этой модели с контекстом 16K? Ничего не скачивается: копия использует те же веса, почти не занимает места и удаляется здесь же. При работе потребляет больше памяти.",
    ctx16Do: "Создать копию",
    cancel: "Отмена",
    creating: "Создаю…",
    copyBadge: "копия AIDE",
    remove: "Удалить копию",
    removeAsk: "Удалить эту копию? Исходная модель останется.",
    removeDo: "Удалить",
    failed: "Не получилось:",
  },
  tg: {
    title: "Моделҳои маҳаллӣ",
    intro: "Моделҳоро дар ин компютер тавассути Ollama ё LM Studio иҷро кунед: бе калиди API ва интернет, коди шумо аз компютер берун намеравад. AIDE серверҳои фаъолро худаш меёбад.",
    check: "Аз нав санҷидан",
    checking: "Месанҷам…",
    running: "Фаъол",
    stopped: "Фаъол нест",
    models: "Моделҳо",
    noModels: "Ҳоло модел нест.",
    use: "Интихоб",
    active: "Интихоб шуд",
    address: "Суроға",
    addressHint: "Порти дигар? Танҳо суроғаҳои ин компютер иҷозат дода мешаванд.",
    save: "Нигоҳ доштан",
    invalid: "Суроғаи ин компютерро нависед, масалан http://127.0.0.1:11434",
    startOllama: "Ollama-ро насб кунед (ollama.com) ва барномаро ё фармони `ollama serve`-ро иҷро кунед. Моделеро бо дастгирии асбобҳо кашед, масалан `ollama pull qwen2.5-coder:7b`.",
    startLm: "Дар LM Studio Developer → Start Server (порт 1234)-ро кушоед ва моделро бор кунед.",
    tools: "асбобҳо",
    noTools: "бе асбобҳо",
    smallCtx: "контексти хурд",
    upTo: "то",
    loaded: "бор шудааст",
    compact: "Агенти ихчам",
    compactHint: "Дастурҳои кӯтоҳ ва танҳо асбобҳои асосӣ (файлҳо, ҷустуҷӯ, терминал, хатоҳо, малакаҳо). Моделҳои хурд ин тавр камтар хато мекунанд. Барои моделҳои калон хомӯш кардан мумкин аст.",
    ctxNote: "Агент контексти аз 8K кам набояд, беҳтараш 16K ва бештар. Ollama: пеш аз оғоз OLLAMA_CONTEXT_LENGTH=16384 гузоред. LM Studio: ҳангоми боркунии модел «Context Length»-ро зиёд кунед.",
    noToolsNote: "Модели бе дастгирии асбобҳо наметавонад файлҳоро ҳамчун агент тағйир диҳад. Барои чат ва реҷаи «Нақша» мувофиқ аст.",
    ctx16: "Контексти 16K",
    ctx16Why: "Ollama моделҳоро бо контексти 4K оғоз мекунад ва агент ба он намеғунҷад: оғози сӯҳбат хомӯшона партофта мешавад.",
    ctx16Ask: "Нусхаи ин моделро бо контексти 16K эҷод кунем? Чизе зеркашӣ намешавад: нусха ҳамон вазнҳоро истифода мебарад, қариб ҷой намегирад ва дар ҳамин ҷо нест карда мешавад. Ҳангоми кор хотираи бештар мегирад.",
    ctx16Do: "Эҷоди нусха",
    cancel: "Бекор",
    creating: "Эҷод мекунам…",
    copyBadge: "нусхаи AIDE",
    remove: "Нест кардани нусха",
    removeAsk: "Ин нусха нест карда шавад? Модели аслӣ мемонад.",
    removeDo: "Нест кардан",
    failed: "Нашуд:",
  },
};
type Strings = (typeof TEXT)["en"];

const SERVERS: { id: LocalServerId; name: string }[] = [
  { id: "ollama", name: "Ollama" },
  { id: "lmstudio", name: "LM Studio" },
];

function Badge({ tone, children }: { tone: "ok" | "warn" | "bad" | "dim"; children: React.ReactNode }) {
  const cls = {
    ok: "bg-teal-300/10 text-teal-200",
    warn: "bg-amber-300/10 text-amber-200",
    bad: "bg-red-400/10 text-red-300",
    dim: "bg-white/[0.06] text-ink-300",
  }[tone];
  return <span className={"rounded px-1.5 py-px text-[11px] " + cls}>{children}</span>;
}

type CopyStage = "idle" | "ask" | "busy" | "askRemove";

function ModelRow({
  m,
  server,
  all,
  L,
  active,
  onUse,
  onChanged,
}: {
  m: LocalModelInfo;
  server: LocalServerStatus;
  all: readonly LocalModelInfo[];
  L: Strings;
  active: boolean;
  onUse: () => void;
  onChanged: () => void;
}) {
  const fit = modelFit(m);
  const isOllama = server.id === "ollama";
  const isCopy = isOllama && isAideVariant(m.id);
  const offerCopy = isOllama && canMakeVariant(m, all);
  const [stage, setStage] = useState<CopyStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const run = (job: () => Promise<unknown>) => {
    setStage("busy");
    setError(null);
    job()
      .then(() => {
        setStage("idle");
        onChanged();
      })
      .catch((e) => {
        setStage("idle");
        setError(String(e));
      });
  };
  // Для запущенной модели — реальный контекст; иначе максимум («до 256K»): реальный зависит от настроек сервера.
  const ctx = m.context ? (m.contextRunning ? `${formatContext(m.context)} ctx` : `${L.upTo} ${formatContext(m.context)} ctx`) : "";
  const facts = [m.params, formatSize(m.sizeBytes), ctx, m.quant].filter(Boolean).join(" · ");
  return (
    <Row
      title={<span className="break-all font-mono text-[13px]">{m.id}</span>}
      hint={
        <span className="flex flex-wrap items-center gap-1.5">
          {facts && <span className="text-ink-400">{facts}</span>}
          {fit === "no-tools" && <Badge tone="bad">{L.noTools}</Badge>}
          {fit === "small-context" && <Badge tone="warn">{L.smallCtx}</Badge>}
          {m.tools === true && fit !== "small-context" && <Badge tone="ok">{L.tools}</Badge>}
          {m.loaded && <Badge tone="dim">{L.loaded}</Badge>}
          {isCopy && <Badge tone="dim">{L.copyBadge}</Badge>}
          <span className="sr-only">{server.name}</span>
        </span>
      }
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {offerCopy && stage === "idle" && (
            <Btn onClick={() => setStage("ask")} title={L.ctx16Why}>
              {L.ctx16}
            </Btn>
          )}
          {isCopy && stage === "idle" && <Btn onClick={() => setStage("askRemove")}>{L.remove}</Btn>}
          {active ? (
            <span className="inline-flex h-8 items-center gap-1.5 px-2 text-[13px] text-ink-300">
              <Check size={14} />
              {L.active}
            </span>
          ) : (
            <Btn onClick={onUse}>{L.use}</Btn>
          )}
        </div>
        {stage === "ask" && (
          <div role="group" aria-label={L.ctx16} className="space-y-2 rounded-md bg-white/[0.04] p-2.5 text-[12.5px] leading-5 text-ink-300">
            <p>{L.ctx16Why}</p>
            <p>{L.ctx16Ask}</p>
            <div className="flex justify-end gap-2">
              <Btn onClick={() => setStage("idle")}>{L.cancel}</Btn>
              <Btn onClick={() => run(() => localApi.createVariant(server.baseUrl, m.id))}>{L.ctx16Do}</Btn>
            </div>
          </div>
        )}
        {stage === "askRemove" && (
          <div role="group" aria-label={L.remove} className="space-y-2 rounded-md bg-white/[0.04] p-2.5 text-[12.5px] leading-5 text-ink-300">
            <p>{L.removeAsk}</p>
            <div className="flex justify-end gap-2">
              <Btn onClick={() => setStage("idle")}>{L.cancel}</Btn>
              <Btn onClick={() => run(() => localApi.deleteVariant(server.baseUrl, m.id))}>{L.removeDo}</Btn>
            </div>
          </div>
        )}
        {stage === "busy" && (
          <div className="flex items-center justify-end gap-2 text-[12.5px] text-ink-300" role="status">
            <Loader2 size={14} className="animate-spin" />
            {L.creating}
          </div>
        )}
        {error && (
          <p role="alert" className="break-words text-[12.5px] text-red-400">
            {L.failed} {error}
          </p>
        )}
      </div>
    </Row>
  );
}

function AddressRow({ id, L }: { id: LocalServerId; L: Strings }) {
  const current = useAi((s) => s.providers.find((p) => p.id === id)?.baseUrl ?? LOCAL_DEFAULTS[id]);
  const [value, setValue] = useState(current);
  const [bad, setBad] = useState(false);
  useEffect(() => setValue(current), [current]);
  const save = () => setBad(useAi.getState().setLocalUrl(id, value) === "invalid");
  return (
    <Row title={L.address} hint={bad ? <span role="alert" className="text-red-400">{L.invalid}</span> : L.addressHint}>
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <input
          aria-label={`${L.address} ${id}`}
          aria-invalid={bad}
          value={value}
          onChange={(e) => { setValue(e.target.value); setBad(false); }}
          spellCheck={false}
          autoComplete="off"
          className={inputClass + " font-mono"}
        />
        <Btn type="submit" disabled={value.trim() === current}>{L.save}</Btn>
      </form>
    </Row>
  );
}

export function LocalModelsSection() {
  const { lang } = useI18n();
  const L: Strings = lang === "tg" ? TEXT.tg : isRuLike(lang) ? TEXT.ru : TEXT.en;
  const providerId = useAi((s) => s.providerId);
  const model = useAi((s) => s.model);
  const compact = useAi((s) => s.localCompact);
  const providers = useAi((s) => s.providers);
  const [status, setStatus] = useState<LocalServerStatus[] | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const targets = SERVERS.map((s) => ({ id: s.id, baseUrl: providers.find((p) => p.id === s.id)?.baseUrl ?? LOCAL_DEFAULTS[s.id] }));
  const key = targets.map((t) => t.baseUrl).join("|");

  const probe = useCallback(() => {
    const mine = ++seq.current;
    setBusy(true);
    void localApi
      .probe(targets)
      .then((r) => mine === seq.current && setStatus(r))
      .catch(() => mine === seq.current && setStatus([]))
      .finally(() => mine === seq.current && setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(probe, [probe]);
  // The user starts Ollama in another window and comes back: look again.
  useEffect(() => {
    const onFocus = () => document.visibilityState === "visible" && probe();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [probe]);

  const anyNoTools = (status ?? []).some((s) => s.models.some((m) => modelFit(m) === "no-tools"));

  return (
    <>
      <Section title={L.title}>
        <Row title={L.title} hint={L.intro}>
          <div className="flex justify-end">
            <Btn onClick={probe} disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {busy ? L.checking : L.check}
            </Btn>
          </div>
        </Row>
        <Row title={L.compact} hint={L.compactHint}>
          <div className="flex justify-end">
            <Switch on={compact} onChange={() => useAi.getState().setLocalCompact(!compact)} label={L.compact} />
          </div>
        </Row>
      </Section>

      {SERVERS.map((srv) => {
        const st = status?.find((s) => s.id === srv.id);
        const models = st ? sortLocalModels(st.models) : [];
        return (
          <Section key={srv.id} title={srv.name}>
            <Row
              title={srv.name}
              hint={
                !status ? undefined : st?.running ? (
                  <span className="text-ink-300">
                    {st.version ? `v${st.version} · ` : ""}
                    {L.models}: {models.length}
                  </span>
                ) : (
                  <span className="break-words">{srv.id === "ollama" ? L.startOllama : L.startLm}</span>
                )
              }
            >
              <div className="flex items-center justify-end gap-2 text-[13px] text-ink-300">
                {!status ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <>
                    <span aria-hidden className={"size-2.5 rounded-full " + (st?.running ? "bg-teal-300" : "bg-white/20")} />
                    {st?.running ? L.running : L.stopped}
                  </>
                )}
              </div>
            </Row>
            {st?.running && models.length === 0 && <Row title={L.noModels} />}
            {st?.running &&
              models.map((m) => (
                <ModelRow
                  key={m.id}
                  m={m}
                  server={st}
                  all={st.models}
                  L={L}
                  active={providerId === srv.id && model === m.id}
                  onUse={() => useAi.getState().selectLocalModel(srv.id, m.id)}
                  onChanged={probe}
                />
              ))}
            <AddressRow id={srv.id} L={L} />
          </Section>
        );
      })}

      <p className="-mt-4 mb-8 space-y-1 px-1 text-[12.5px] leading-5 text-ink-500">
        <span className="block">{L.ctxNote}</span>
        {anyNoTools && <span className="block">{L.noToolsNote}</span>}
      </p>
    </>
  );
}
