import { isRuLike } from "@/i18n/ruLike";
import { useEffect, useMemo, useState } from "react";
import { Download, Loader2, Trash2 } from "lucide-react";
import { useI18n } from "@/i18n";
import { Btn, Row, Section, inputClass } from "@/features/settings/SettingsPanel";
import { Select } from "@/ui/Select";
import { extApi, type SearchItem } from "@/features/extensions/manifest";
import { useExtensions } from "@/features/extensions/store";
import { useExtHost } from "@/features/exthost/store";

const TEXT = {
  en: {
    title: "Extensions (Open VSX)",
    theme: "Editor color theme",
    themeHint: "Themes come from installed extensions. Only the editor is recolored.",
    none: "Default",
    search: "Search Open VSX",
    placeholder: "Theme, language or snippet name",
    find: "Search",
    all: "All",
    themes: "Themes",
    snippets: "Snippets",
    langs: "Languages",
    install: "Install",
    installed: "Installed",
    remove: "Remove",
    empty: "Nothing found",
    none2: "No extensions installed yet",
    uses: "Provides",
    t: "themes",
    s: "snippet sets",
    g: "grammars",
    notice:
      "Extensions come from the open catalog Open VSX, not the Microsoft marketplace. Themes, snippets and grammars work right away. An extension's code (commands, formatters, linters, language features) runs in a separate Node.js process only after you switch it on, and only for the VS Code API that AIDE implements; panels, webviews and debuggers are not supported yet.",
    more: "Show more",
    runCode: "Run extension code",
    codeOff: "Code is off",
    codeOn: "Code is running",
    codeErr: "Failed to start",
    trustTitle: "Run this extension's code?",
    trustText: "Like in VS Code, the extension is a program: it will run with your user rights and can read and change your files, start programs and use the network. Enable only extensions you trust.",
    trustYes: "Enable",
    needNode: "Extensions that run code need Node.js (nodejs.org). It was not found.",
    hostLog: "Extension host log",
    hostRestart: "Restart host",
    hostState: "Host",
    bigTitle: "Large package",
    bigText: (mb: number) =>
      `This package is ${mb} MB. It most likely contains program code or binaries that AIDE does not run: only themes, snippets and grammars are taken from it. Antivirus tools may scan the download. Continue?`,
    bigYes: "Download anyway",
    cancel: "Cancel",
  },
  ru: {
    title: "Расширения (Open VSX)",
    theme: "Цветовая тема редактора",
    themeHint: "Темы берутся из установленных расширений. Перекрашивается только редактор.",
    none: "По умолчанию",
    search: "Поиск в Open VSX",
    placeholder: "Тема, язык или название сниппетов",
    find: "Найти",
    all: "Все",
    themes: "Темы",
    snippets: "Сниппеты",
    langs: "Языки",
    install: "Установить",
    installed: "Установлено",
    remove: "Удалить",
    empty: "Ничего не найдено",
    none2: "Расширений пока нет",
    uses: "Даёт",
    t: "тем",
    s: "наборов сниппетов",
    g: "грамматик",
    notice:
      "Расширения берутся из открытого каталога Open VSX, а не из магазина Microsoft. Темы, сниппеты и грамматики работают сразу. Код расширения (команды, форматирование, проверки, языковые возможности) запускается в отдельном процессе Node.js только после того, как вы его включите, и лишь в той части API VS Code, которую реализует AIDE; панели, веб-вью и отладчики пока не поддерживаются.",
    more: "Показать ещё",
    runCode: "Запускать код расширения",
    codeOff: "Код выключен",
    codeOn: "Код работает",
    codeErr: "Не удалось запустить",
    trustTitle: "Запускать код этого расширения?",
    trustText: "Как и в VS Code, расширение — это программа: оно работает с правами вашего пользователя, может читать и менять файлы, запускать программы и выходить в сеть. Включайте только те, которым доверяете.",
    trustYes: "Включить",
    needNode: "Для расширений с кодом нужен Node.js (nodejs.org). Он не найден.",
    hostLog: "Журнал хоста расширений",
    hostRestart: "Перезапустить хост",
    hostState: "Хост",
    bigTitle: "Крупный пакет",
    bigText: (mb: number) =>
      `Пакет весит ${mb} МБ. Скорее всего, в нём программный код или бинарные файлы, которые AIDE не запускает: из него берутся только темы, сниппеты и грамматики. Антивирус может проверить загрузку. Продолжить?`,
    bigYes: "Всё равно скачать",
    cancel: "Отмена",
  },
};

const CATEGORIES = [
  { id: "", key: "all" },
  { id: "Themes", key: "themes" },
  { id: "Snippets", key: "snippets" },
  { id: "Programming Languages", key: "langs" },
] as const;

const fmt = (n?: number) => (n === undefined ? "" : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));

// Icons come from open-vsx.org only; anything else is not rendered.
const safeIcon = (u?: string) => (u && /^https:\/\/(open-vsx\.org|openvsx\.eclipsecontent\.org|openvsxorg\.blob\.core\.windows\.net)\//.test(u) ? u : undefined);

export function ExtensionsSection() {
  const { lang } = useI18n();
  const L = isRuLike(lang) ? TEXT.ru : TEXT.en;
  const { installed, themeKey, busy, error, refresh, install, remove, setTheme, loaded, large, dismissLarge } = useExtensions();
  const themes = useMemo(() => installed.flatMap((e) => e.themes.map((t) => ({ key: `${e.id}::${t.label}`, label: t.label }))), [installed]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("Themes");
  const [items, setItems] = useState<SearchItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const host = useExtHost();
  const [confirmTrust, setConfirmTrust] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);

  useEffect(() => {
    if (!loaded) void refresh();
  }, [loaded, refresh]);

  useEffect(() => {
    void useExtHost.getState().refreshTrust();
    void useExtHost.getState().loadInfo();
  }, []);

  const search = async (offset = 0, cat = category) => {
    setSearching(true);
    setSearchError(null);
    try {
      const res = await extApi.search(query, offset, cat || undefined);
      setItems((cur) => (offset > 0 && cur ? [...cur, ...res.items] : res.items));
      setTotal(res.total);
    } catch (e) {
      setSearchError(typeof e === "string" ? e : e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  };

  const isInstalled = (it: SearchItem) => installed.some((e) => e.id === `${it.namespace}.${it.name}`);

  return (
    <Section title={L.title}>
      <Row title={L.theme} hint={L.themeHint}>
        <Select
          variant="field"
          value={themeKey ?? ""}
          options={[{ value: "", label: L.none }, ...themes.map((t) => ({ value: t.key, label: t.label }))]}
          onChange={(v) => void setTheme(v || null)}
          menuMinWidth={260}
        />
      </Row>

      <div className="space-y-3 px-5 py-4">
        <div className="text-[14px] font-medium text-ink-100">{L.search}</div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void search(0);
          }}
        >
          <input value={query} maxLength={100} onChange={(e) => setQuery(e.target.value)} placeholder={L.placeholder} className={inputClass} />
          <Btn type="submit" variant="primary" disabled={searching} className="shrink-0">
            {searching ? <Loader2 size={14} className="animate-spin" /> : L.find}
          </Btn>
        </form>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              aria-pressed={category === c.id}
              onClick={() => {
                setCategory(c.id);
                void search(0, c.id);
              }}
              className="h-7 rounded-md px-2.5 text-[12.5px] text-ink-400 transition-colors hover:text-ink-50 aria-pressed:bg-white/[0.09] aria-pressed:text-ink-50"
            >
              {L[c.key]}
            </button>
          ))}
        </div>
        {large && (
          <div role="alert" className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-3 text-[13px] leading-5 text-amber-100">
            <div className="mb-1 font-medium">{L.bigTitle}: {large.namespace}.{large.name}</div>
            <div>{L.bigText(Math.round(large.bytes / 1_048_576))}</div>
            <div className="mt-2.5 flex gap-2">
              <Btn variant="primary" onClick={() => void install(large.namespace, large.name, true)}>{L.bigYes}</Btn>
              <Btn variant="ghost" onClick={dismissLarge}>{L.cancel}</Btn>
            </div>
          </div>
        )}
        {(searchError || error) && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-[13px] text-red-300">{searchError ?? error}</div>}
        {items && items.length === 0 && <div className="text-[13px] text-ink-500">{L.empty}</div>}
        {items && items.length > 0 && (
          <ul className="divide-y divide-line/60 rounded-lg border border-line">
            {items.map((it) => {
              const id = `${it.namespace}.${it.name}`;
              const icon = safeIcon(it.iconUrl);
              return (
                <li key={id} className="flex items-center gap-3 px-3 py-2.5">
                  {icon ? <img src={icon} alt="" className="size-9 shrink-0 rounded-md" referrerPolicy="no-referrer" /> : <div className="size-9 shrink-0 rounded-md bg-white/[0.06]" />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium text-ink-100">
                      {it.displayName || it.name} <span className="font-normal text-ink-500">{it.namespace} · {it.version}</span>
                    </div>
                    <div className="truncate text-[12.5px] text-ink-400">{it.description}</div>
                  </div>
                  <span className="hidden shrink-0 items-center gap-1 text-[12px] text-ink-500 sm:flex">
                    <Download size={12} />
                    {fmt(it.downloadCount)}
                  </span>
                  {isInstalled(it) ? (
                    <span className="shrink-0 text-[12.5px] text-ink-400">{L.installed}</span>
                  ) : (
                    <Btn disabled={busy !== null} onClick={() => void install(it.namespace, it.name)} className="shrink-0">
                      {busy === id ? <Loader2 size={14} className="animate-spin" /> : L.install}
                    </Btn>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {items && items.length < total && (
          <Btn variant="ghost" disabled={searching} onClick={() => void search(items.length)}>
            {L.more}
          </Btn>
        )}
      </div>

      <div className="px-5 py-4">
        <div className="mb-2 text-[14px] font-medium text-ink-100">{L.installed}</div>
        {installed.length === 0 ? (
          <div className="text-[13px] text-ink-500">{L.none2}</div>
        ) : (
          <ul className="space-y-1">
            {installed.map((e) => (
              <li key={e.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/[0.04]">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] text-ink-100">
                    {e.displayName} <span className="text-ink-500">{e.version}</span>
                  </div>
                  <div className="truncate text-[12px] text-ink-500">
                    {L.uses}: {e.themes.length} {L.t} · {e.snippets.length} {L.s} · {e.grammars.length} {L.g}
                  </div>
                </div>
                {e.main && (
                  <button
                    role="switch"
                    aria-checked={host.trusted.includes(e.id)}
                    aria-label={L.runCode}
                    title={L.runCode}
                    onClick={() => (host.trusted.includes(e.id) ? void host.setTrusted(e.id, false) : setConfirmTrust(e.id))}
                    className={"relative h-6 w-11 shrink-0 rounded-full transition-colors " + (host.trusted.includes(e.id) ? "bg-teal-300" : "bg-white/[0.14]")}
                  >
                    <span className={"absolute top-0.5 size-5 rounded-full bg-canvas transition-all " + (host.trusted.includes(e.id) ? "left-[22px]" : "left-0.5")} />
                  </button>
                )}
                <Btn variant="danger" aria-label={L.remove} title={L.remove} disabled={busy !== null} onClick={() => void remove(e.id)}>
                  {busy === e.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                </Btn>
              </li>
            ))}
          </ul>
        )}
      </div>
      {confirmTrust && (
        <div role="alert" className="mx-5 mb-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-3 text-[13px] leading-5 text-amber-100">
          <div className="mb-1 font-medium">{L.trustTitle} {confirmTrust}</div>
          <div>{L.trustText}</div>
          <div className="mt-2.5 flex gap-2">
            <Btn variant="primary" onClick={() => { void host.setTrusted(confirmTrust, true); setConfirmTrust(null); }}>{L.trustYes}</Btn>
            <Btn variant="ghost" onClick={() => setConfirmTrust(null)}>{L.cancel}</Btn>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-[12.5px] text-ink-400">
        <span>{L.hostState}: {host.status}{host.nodeVersion ? ` · Node ${host.nodeVersion}` : ""}</span>
        {host.trusted.length > 0 && host.nodeVersion === null && host.status !== "starting" && <span className="text-amber-300">{L.needNode}</span>}
        {host.error && <span className="text-red-300">{host.error}</span>}
        {Object.entries(host.extStates).filter(([, v]) => v.state === "error").map(([id, v]) => <span key={id} className="text-red-300">{id}: {L.codeErr}{v.message ? ` — ${v.message.split("\n")[0].replace(/^Error:\s*/, "").slice(0, 220)}` : ""}</span>)}
        <button className="underline decoration-ink-700 underline-offset-2 hover:text-ink-100" onClick={() => void host.restart()}>{L.hostRestart}</button>
        <button className="underline decoration-ink-700 underline-offset-2 hover:text-ink-100" onClick={() => setShowLog((v) => !v)}>{L.hostLog}</button>
      </div>
      {showLog && <pre className="aide-scroll mx-5 mb-3 max-h-48 select-text overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/30 p-2.5 font-mono text-[11.5px] leading-5 text-ink-300">{host.logs.join("\n") || "—"}</pre>}
      <div className="px-5 py-3 text-[12px] leading-5 text-ink-500">{L.notice}</div>
    </Section>
  );
}
