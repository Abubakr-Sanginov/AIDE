import { rt } from "@/i18n/tgMap";
import { isRuLike } from "@/i18n/ruLike";
import { useEffect, useState, type ReactNode } from "react";
import {
  Bell,
  Bot,
  Braces,
  Cpu,
  FileSearch,
  Brain,
  FileText,
  Check,
  ChevronLeft,
  Download,
  Keyboard,
  Mic,
  Loader2,
  Palette,
  Plug,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
  Sparkles,
  SquareTerminal,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useI18n } from "@/i18n";
import { Select } from "@/ui/Select";
import { LANGUAGES, type Lang } from "@/i18n/translations";
import { useAi } from "@/stores/ai";
import { SkillsSection } from "@/features/settings/SkillsSection";
import { AgentSkillsSection } from "@/features/skills/AgentSkillsSection";
import { ExtensionsSection } from "@/features/settings/ExtensionsSection";
import { EXTENSIONS_ENABLED } from "@/features/extensions/flag";
import { dirOf, getMotionPref, setMotionPref, viewTransition, type MotionPref } from "@/lib/motion";
import { Indicator, useIndicator } from "@/ui/Indicator";
import { McpSection } from "@/features/settings/McpSection";
import { LspSection } from "@/features/settings/LspSection";
import { LocalModelsSection } from "@/features/settings/LocalModelsSection";
import { NotificationsSection } from "@/features/settings/NotificationsSection";
import { UpdatesSection } from "@/features/settings/UpdatesSection";
import { CodeIndexSection } from "@/features/settings/CodeIndexSection";
import { isLocalProvider } from "@/lib/localProviders";
import { MemorySection, RulesSection } from "@/features/settings/ContextSections";
import { useUi } from "@/stores/ui";
import { SHELL_LABEL, useTerminal } from "@/stores/terminal";
import type { ShellKind } from "@/api/terminal";
import { invoke } from "@tauri-apps/api/core";
import { refreshWhisper } from "@/features/kins/voice";
import type { CliToolInfo, ProviderConfig, ProviderKind } from "@/api/ai";

const KIND_NAMES: Record<ProviderKind, string> = {
  openai: "OpenAI-compatible",
  anthropic: "Anthropic",
  google: "Google Gemini",
};

const KIND_DEFAULTS: Record<ProviderKind, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  google: "https://generativelanguage.googleapis.com",
};

import { providerSlug } from "@/lib/customProvider";
import { normalizeModelId } from "@/lib/modelSelection";

/* ── Building blocks ───────────────────────────────────────── */

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-2.5 px-1 text-[13px] font-medium text-ink-400">{title}</h2>
      <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-raised">{children}</div>
    </section>
  );
}

export function Row({ title, hint, children }: { title: ReactNode; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 px-5 py-4">
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium text-ink-100">{title}</div>
        {hint && <div className="mt-0.5 text-[12.5px] leading-5 text-ink-400">{hint}</div>}
      </div>
      {children && <div className="w-[300px] shrink-0">{children}</div>}
    </div>
  );
}

export const inputClass =
  "h-9 w-full rounded-lg border border-line-strong bg-canvas px-3 text-[13px] text-ink-100 outline-none transition-colors placeholder:text-ink-500 focus:border-white/30";

type BtnVariant = "primary" | "secondary" | "ghost" | "danger";

export function Btn({
  variant = "secondary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  const styles: Record<BtnVariant, string> = {
    primary: "bg-ink-100 text-canvas hover:bg-white",
    secondary: "bg-white/[0.07] text-ink-100 hover:bg-white/[0.12]",
    ghost: "text-ink-300 hover:bg-white/[0.06] hover:text-ink-50",
    danger: "text-ink-300 hover:bg-red-500/15 hover:text-red-300",
  };
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${styles[variant]} ${className}`}
    />
  );
}

/* ── Navigation ────────────────────────────────────────────── */

type PageId = "agent" | "memory" | "rules" | "voice" | "mcp" | "skills" | "extensions" | "appearance" | "terminal" | "hotkeys" | "lsp" | "local" | "index" | "notifications" | "updates";

interface NavItem {
  id: PageId;
  ru: string;
  en: string;
  keys: string;
  icon: LucideIcon;
}

const NAV: { id: string; ru: string; en: string; items: NavItem[] }[] = [
  {
    id: "project",
    ru: "Агент и проект",
    en: "Agent and project",
    items: [
      { id: "agent", ru: "Агент", en: "Agent", keys: "модель ключ провайдер api model key provider openrouter openai anthropic", icon: Bot },
      { id: "local", ru: "Локальные модели", en: "Local models", keys: "ollama lm studio локально офлайн без ключа local offline llama qwen", icon: Cpu },
      { id: "index", ru: "Индекс кода", en: "Code index", keys: "индекс поиск символы определения функции search symbols index map project карта проекта", icon: FileSearch },
      { id: "memory", ru: "Память", en: "Memory", keys: "заметки предпочтения notes memory", icon: Brain },
      { id: "rules", ru: "Правила проекта", en: "Project rules", keys: "agents.md claude.md правила rules", icon: FileText },
      { id: "voice", ru: "Голос", en: "Voice", keys: "whisper groq микрофон речь распознавание speech microphone", icon: Mic },
      { id: "mcp", ru: "Серверы MCP", en: "MCP servers", keys: "mcp инструменты tools протокол server", icon: Plug },
      { id: "skills", ru: "Навыки", en: "Skills", keys: "skills навыки", icon: Sparkles },
      ...(EXTENSIONS_ENABLED ? [{ id: "extensions", ru: "Расширения", en: "Extensions", keys: "плагины vscode open vsx extensions plugins", icon: Puzzle } as NavItem] : []),
    ],
  },
  {
    id: "computer",
    ru: "Этот компьютер",
    en: "This computer",
    items: [
      { id: "appearance", ru: "Внешний вид", en: "Appearance", keys: "тема язык theme language", icon: Palette },
      { id: "terminal", ru: "Терминал", en: "Terminal", keys: "шелл powershell cmd bash shell", icon: SquareTerminal },
      { id: "lsp", ru: "Языковые серверы", en: "Language servers", keys: "lsp автодополнение completion typescript rust python go clangd ошибки errors", icon: Braces },
      { id: "notifications", ru: "Уведомления", en: "Notifications", keys: "уведомления звук тихие часы push notifications sound quiet", icon: Bell },
      { id: "updates", ru: "Обновления", en: "Updates", keys: "обновление версия update version upgrade", icon: Download },
      { id: "hotkeys", ru: "Горячие клавиши", en: "Hotkeys", keys: "shortcuts клавиши сочетания", icon: Keyboard },
    ],
  },
];

const TITLES: Record<PageId, { ru: [string, string]; en: [string, string] }> = {
  agent: {
    ru: ["Агент", "Выберите провайдера, ключ и модель для агента."],
    en: ["Agent", "Pick the provider, key and model for the agent."],
  },
  memory: { ru: ["Память", "Заметки, которые агент видит в каждом запросе."], en: ["Memory", "Notes the agent sees in every request."] },
  rules: { ru: ["Правила проекта", "Что агент должен знать об этом проекте."], en: ["Project rules", "What the agent should know about this project."] },
  voice: { ru: ["Голос", "Распознавание речи для созвона Экипажа."], en: ["Voice", "Speech recognition for the crew call."] },
  mcp: { ru: ["Серверы MCP", "Внешние инструменты для агента: память, браузер, свои программы."], en: ["MCP servers", "External tools for the agent: memory, browser, your own programs."] },
  skills: { ru: ["Навыки", "Готовые инструкции, которые агент подключает по задаче."], en: ["Skills", "Ready-made instructions the agent loads when a task needs them."] },
  extensions: { ru: ["Расширения", "Расширения VS Code из Open VSX: темы, языки, форматтеры."], en: ["Extensions", "VS Code extensions from Open VSX: themes, languages, formatters."] },
  appearance: { ru: ["Внешний вид", "Тема и язык интерфейса."], en: ["Appearance", "Theme and interface language."] },
  terminal: { ru: ["Терминал", "Какая оболочка открывается по умолчанию."], en: ["Terminal", "Which shell opens by default."] },
  hotkeys: { ru: ["Горячие клавиши", "Сочетания клавиш в редакторе."], en: ["Hotkeys", "Keyboard shortcuts in the editor."] },
  index: { ru: ["Индекс кода", "Карта проекта и умный поиск: агент сам находит нужные файлы."], en: ["Code index", "A map of the project and smart search: the agent finds the right files itself."] },
  local: { ru: ["Локальные модели", "Ollama и LM Studio: модели на вашем компьютере, без ключа и интернета."], en: ["Local models", "Ollama and LM Studio: models on your computer, no key and no internet."] },
  notifications: { ru: ["Уведомления", "О чём и когда AIDE сообщает, пока вы в другом окне."], en: ["Notifications", "What AIDE tells you about, and when, while you are in another window."] },
  updates: { ru: ["Обновления", "Версия AIDE и поиск новой версии."], en: ["Updates", "AIDE version and checking for a new one."] },
  lsp: { ru: ["Языковые серверы", "Подсказки по типам, переход к определению и ошибки в коде."], en: ["Language servers", "Type-aware completion, go to definition and errors in the code."] },
};
const title = (p: PageId, ru: boolean) => (ru ? rt(TITLES[p].ru[0]) : TITLES[p].en[0]);
const subtitle = (p: PageId, ru: boolean) => (ru ? rt(TITLES[p].ru[1]) : TITLES[p].en[1]);

function VoiceSettings({ ru }: { ru: boolean }) {
  const [has, setHas] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    void refreshWhisper().then(setHas);
  }, []);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setHas(await refreshWhisper());
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Whisper · Groq">
      <Row
        title={ru ? rt("Ключ Groq") : "Groq key"}
        hint={
          has ? (
            <span className="inline-flex items-center gap-1 text-ink-300">
              <Check size={13} />
              {ru ? rt("Ключ сохранён. Созвон слушает через Whisper (whisper-large-v3-turbo).") : "Key saved. The call listens through Whisper (whisper-large-v3-turbo)."}
            </span>
          ) : ru ? (
            rt("Без ключа используется распознавание браузера, если оно есть в этом окне. Ключ хранится в защищённом хранилище Windows и не показывается после сохранения.")
          ) : (
            "Without a key the browser's recognizer is used when this window has one. The key is kept in the Windows credential store and is never shown again."
          )
        }
      >
        <div className="space-y-2">
          <input
            type="password"
            value={key}
            autoComplete="off"
            spellCheck={false}
            placeholder={has ? (ru ? rt("Заменить ключ…") : "Replace key…") : "gsk_…"}
            onChange={(e) => setKey(e.target.value)}
            className={inputClass}
          />
          <div className="flex items-center gap-2">
            <Btn
              variant="primary"
              disabled={busy || !key.trim()}
              onClick={() =>
                void run(async () => {
                  await invoke("stt_save_key", { key });
                  setKey("");
                  setMsg({ ok: true, text: ru ? rt("Ключ сохранён") : "Key saved" });
                })
              }
            >
              {ru ? rt("Сохранить") : "Save"}
            </Btn>
            {has && (
              <Btn
                variant="danger"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await invoke("stt_clear_key");
                    setMsg({ ok: true, text: ru ? rt("Ключ удалён") : "Key removed" });
                  })
                }
              >
                {ru ? rt("Удалить") : "Remove"}
              </Btn>
            )}
            {busy && <Loader2 size={14} className="animate-spin text-ink-500" />}
          </div>
          {msg && <div className={"text-[12.5px] " + (msg.ok ? "text-ink-300" : "text-red-400")}>{msg.text}</div>}
        </div>
      </Row>
    </Section>
  );
}

function TerminalSettings({ ru }: { ru: boolean }) {
  const shells = useTerminal((s) => s.shells);
  const last = useTerminal((s) => s.lastShell);
  return (
    <Section title={ru ? rt("Оболочка") : "Shell"}>
      <Row
        title={ru ? rt("Оболочка по умолчанию") : "Default shell"}
        hint={ru ? rt("Её откроет кнопка «+» в терминале. Другие можно выбрать стрелкой рядом.") : "Opened by the + button in the terminal. Pick others with the arrow next to it."}
      >
        <Select
          variant="field"
          value={last}
          onChange={(v) => useTerminal.setState({ lastShell: v as ShellKind })}
          options={shells.map((k) => ({ value: k, label: SHELL_LABEL[k] }))}
        />
      </Row>
    </Section>
  );
}

function HotkeysSection({ ru }: { ru: boolean }) {
  const rows: [string, string, string][] = [
    ["Ctrl + P", "Файлы и команды", "Files and commands"],
    ["Ctrl + Shift + F", "Поиск по проекту", "Search in project"],
    ["Ctrl + Shift + G", "Система контроля версий", "Source control"],
    ["Ctrl + B", "Показать или скрыть боковую панель", "Toggle the sidebar"],
    ["Ctrl + J", "Показать или скрыть терминал", "Toggle the terminal"],
    ["Ctrl + O", "Открыть папку", "Open folder"],
    ["Ctrl + S", "Сохранить файл", "Save file"],
    ["Ctrl + W", "Закрыть вкладку", "Close tab"],
  ];
  return (
    <Section title={ru ? rt("Сочетания") : "Shortcuts"}>
      {rows.map(([keys, r, e]) => (
        <Row key={keys} title={ru ? rt(r) : e}>
          <kbd className="ml-auto block w-fit rounded-md bg-white/[0.07] px-2 py-1 font-mono text-[12.5px] text-ink-200">{keys}</kbd>
        </Row>
      ))}
    </Section>
  );
}

/* ── Page ──────────────────────────────────────────────────── */

export function SettingsPage() {
  const { t, lang, setLang } = useI18n();
  const closeSettings = useUi((s) => s.closeSettings);
  const {
    providers,
    providerId,
    hasKey,
    models,
    model,
    modelsLoading,
    modelsError,
    setProvider,
    setModel,
    saveKey,
    clearKey,
    refreshModels,
    addCustomProvider,
    removeCustomProvider,
    importCliTools,
    useCliTool,
    testConnection,
  } = useAi();
  const [manualModel, setManualModel] = useState("");
  const [modelError, setModelError] = useState(false);
  useEffect(() => {
    setManualModel(model);
    setModelError(false);
  }, [providerId, model]);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [kind, setKind] = useState<ProviderKind>("openai");
  const [baseUrl, setBaseUrl] = useState(KIND_DEFAULTS.openai);
  const [customKey, setCustomKey] = useState("");
  const [cliToolsList, setCliToolsList] = useState<CliToolInfo[]>([]);
  const [cliBusy, setCliBusy] = useState(false);
  const [page, setPage] = useState<PageId>("agent");
  const navIndicator = useIndicator<HTMLElement>(page);
  const [motion, setMotion] = useState<MotionPref>(getMotionPref);
  const goPage = (id: PageId) => {
    if (id === page) return;
    const order = NAV.flatMap((g) => g.items.map((i) => i.id));
    viewTransition(() => setPage(id), "settings", dirOf(order, page, id));
  };
  const [query, setQuery] = useState("");

  const selected = providers.find((p) => p.id === providerId);

  useEffect(() => {
    void importCliTools().then((list) => setCliToolsList(Array.isArray(list) ? list : []));
  }, [importCliTools]);

  const run = async (fn: () => Promise<void>, onError: (e: unknown) => string = String) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setMessage(onError(e));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!key.trim()) return;
    void run(async () => {
      await saveKey(key);
      setKey("");
      setMessage(t("settings.keySaved"));
    });
  };

  const clear = () =>
    void run(async () => {
      await clearKey();
      setMessage(t("settings.keySaved"));
    });

  const addCustom = () => {
    const pid = id.trim() || providerSlug(name);
    if (!/^[a-zA-Z0-9-]{2,40}$/.test(pid)) return setMessage(t("settings.providerIdHint"));
    if (!name.trim()) return setMessage(t("settings.providerName"));
    if (!baseUrl.trim()) return setMessage(t("settings.baseUrl"));
    void run(
      async () => {
        const cfg: ProviderConfig = {
          id: pid,
          name: name.trim(),
          kind,
          baseUrl: baseUrl.trim().replace(/\/+$/, ""),
          custom: true,
        };
        await addCustomProvider(cfg, customKey);
        setName("");
        setId("");
        setCustomKey("");
        setShowForm(false);
        setMessage(t("settings.providerAdded", { name: cfg.name }));
      },
      (e) => {
        const code = e instanceof Error ? e.message : String(e);
        const errors: Record<string, string> = {
          "provider-duplicate": isRuLike(lang) ? "Этот идентификатор уже занят. Укажите другой." : "This provider ID is already in use. Choose another.",
          "provider-url": isRuLike(lang) ? "Укажите адрес API с http:// или https://, без пароля, параметров и #." : "Enter an HTTP(S) API URL without credentials, query or fragment.",
          "provider-id": t("settings.providerIdHint"),
          "provider-name": t("settings.providerName"),
        };
        return t("settings.providerAddError", { error: errors[code] ?? code });
      },
    );
  };

  const remove = (cfg: ProviderConfig) =>
    void run(
      async () => {
        await removeCustomProvider(cfg.id);
        setMessage(t("settings.providerRemoved", { name: cfg.name }));
      },
      (e) => t("settings.providerRemoveError", { error: String(e) }),
    );

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await testConnection());
    } finally {
      setTesting(false);
    }
  };

  const ru = isRuLike(lang);
  const needle = query.trim().toLowerCase();
  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => !needle || i.ru.toLowerCase().includes(needle) || i.en.toLowerCase().includes(needle) || i.keys.includes(needle)),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex min-h-0 flex-1">
      <nav ref={navIndicator.ref} aria-label={t("sidebar.settings")} className="aide-scroll aide-stagger relative isolate flex w-[300px] shrink-0 flex-col overflow-y-auto px-3 pb-6 pt-4">
        <Indicator box={navIndicator.box} radius={12} />
        <button onClick={closeSettings} className="mb-3 flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[15px] font-semibold text-ink-50 hover:bg-white/[0.05]">
          <ChevronLeft size={16} />
          {t("sidebar.settings")}
        </button>
        <div className="mb-3 flex h-10 items-center gap-2 rounded-xl bg-white/[0.05] px-3 text-ink-400 focus-within:bg-white/[0.08]">
          <Search size={15} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={ru ? rt("Поиск настроек") : "Search settings"}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-ink-100 outline-none placeholder:text-ink-500"
          />
        </div>
        {groups.map((g) => (
          <div key={g.id} className="mb-3">
            <div className="px-2 pb-1 pt-2 text-[13px] text-ink-500">{ru ? rt(g.ru) : g.en}</div>
            {g.items.map((i) => {
              const Icon = i.icon;
              return (
                <button
                  key={i.id}
                  aria-current={page === i.id}
                  onClick={() => goPage(i.id)}
                  className="group/nav flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-[14.5px] text-ink-200 transition-colors hover:bg-white/[0.04] aria-[current=true]:text-ink-50"
                >
                  <Icon size={17} className="shrink-0 text-ink-400 transition-transform duration-300 group-hover/nav:scale-110 group-aria-[current=true]/nav:text-teal-200" />
                  {ru ? rt(i.ru) : i.en}
                </button>
              );
            })}
          </div>
        ))}
        {groups.length === 0 && <div className="px-3 py-2 text-[13px] text-ink-500">{ru ? rt("Ничего не найдено") : "Nothing found"}</div>}
      </nav>

      <div className="aide-scroll min-h-0 flex-1 overflow-y-auto">
        <div key={page} className="aide-vt-settings-body aide-stagger mx-auto w-full max-w-[760px] px-8 pb-16 pt-10">
          <h1 className="text-[30px] font-semibold tracking-tight text-ink-50">{title(page, ru)}</h1>
          <p className="mb-8 mt-2 text-[15px] text-ink-300">{subtitle(page, ru)}</p>

          {page === "agent" && (
            <>
        <Section title={t("settings.provider")}>
          <Row title={t("settings.provider")} hint={selected ? `${KIND_NAMES[selected.kind]} · ${selected.baseUrl}` : undefined}>
            <div className="flex items-center gap-2">
              <Select
                variant="field"
                value={providerId}
                onChange={setProvider}
                className="min-w-0 flex-1"
                options={providers.map((p) => ({
                  value: p.id,
                  label: `${p.name}${p.custom ? ` (${t("settings.custom")})` : ""}`,
                }))}
              />
              <Btn
                className="!px-2"
                title={t("settings.addCustom")}
                aria-label={t("settings.addCustom")}
                onClick={() => setShowForm((v) => !v)}
              >
                <Plus size={15} />
              </Btn>
              {selected?.custom && (
                <Btn
                  variant="danger"
                  className="!px-2"
                  title={t("settings.deleteProvider")}
                  aria-label={t("settings.deleteProvider")}
                  onClick={() => remove(selected)}
                  disabled={busy}
                >
                  <Trash2 size={15} />
                </Btn>
              )}
            </div>
          </Row>

          {showForm && (
            <div className="space-y-2.5 bg-canvas/40 px-5 py-4">
              <div className="grid grid-cols-2 gap-2.5">
                <input
                  value={name}
                  placeholder={t("settings.providerName")}
                  onChange={(e) => {
                    setName(e.target.value);
                    // An empty ID is derived from the complete name on submission.
                  }}
                  className={inputClass}
                />
                <input value={id} aria-label={t("settings.providerId")} placeholder={providerSlug(name)} onChange={(e) => setId(e.target.value)} className={inputClass} />
              </div>
              <Select
                variant="field"
                value={kind}
                onChange={(v) => {
                  const k = v as ProviderKind;
                  setKind(k);
                  if (baseUrl === KIND_DEFAULTS[kind]) setBaseUrl(KIND_DEFAULTS[k]);
                }}
                options={(Object.keys(KIND_NAMES) as ProviderKind[]).map((k) => ({ value: k, label: `API: ${KIND_NAMES[k]}` }))}
              />
              <input value={baseUrl} placeholder={t("settings.baseUrl")} onChange={(e) => setBaseUrl(e.target.value)} className={inputClass} />
              <input
                type="password"
                value={customKey}
                placeholder={t("settings.apiKeyOptional")}
                onChange={(e) => setCustomKey(e.target.value)}
                className={inputClass}
                autoComplete="off"
              />
              <div className="flex items-center gap-2 pt-1">
                <Btn variant="primary" onClick={addCustom} disabled={busy}>
                  {t("settings.add")}
                </Btn>
                <Btn
                  variant="ghost"
                  onClick={() => {
                    setShowForm(false);
                    setMessage(null);
                  }}
                >
                  {t("settings.cancel")}
                </Btn>
              </div>
            </div>
          )}

          {isLocalProvider(providerId) ? (
            <Row
              title={`${t("settings.apiKey")} ${selected?.name ?? ""}`}
              hint={ru ? rt("Не нужен: модель работает на вашем компьютере. Список моделей и запуск серверов — на странице «Локальные модели».") : "Not needed: the model runs on your computer. Models and how to start the servers are on the “Local models” page."}
            />
          ) : (
          <Row
            title={`${t("settings.apiKey")} ${selected?.name ?? ""}`}
            hint={
              hasKey ? (
                <span className="inline-flex items-center gap-1 text-ink-300">
                  <Check size={13} />
                  {t("settings.keySaved")}
                </span>
              ) : undefined
            }
          >
            <div className="space-y-2">
              <input
                type="password"
                value={key}
                autoComplete="off"
                placeholder={hasKey ? t("settings.keyPlaceholder") : t("settings.pasteKey")}
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") save();
                }}
                className={inputClass}
              />
              <div className="flex items-center gap-2">
                <Btn variant="primary" onClick={save} disabled={busy || !key.trim()}>
                  {t("settings.save")}
                </Btn>
                {hasKey && (
                  <Btn variant="danger" onClick={clear} disabled={busy}>
                    {t("settings.delete")}
                  </Btn>
                )}
                {busy && <Loader2 size={14} className="animate-spin text-ink-500" />}
              </div>
            </div>
          </Row>
          )}

          <Row title={t("settings.model")} hint={!hasKey ? t("settings.modelHint") : undefined}>
            {hasKey &&
              (modelsLoading ? (
                <div className="flex h-9 items-center gap-2 text-[13px] text-ink-400">
                  <Loader2 size={14} className="animate-spin" />
                  {t("settings.modelsLoading")}
                </div>
              ) : models.length > 0 ? (
                <div className="flex items-center gap-2">
                  <Select
                    variant="field"
                    value={model}
                    onChange={setModel}
                    className="min-w-0 flex-1"
                    options={models.map((m) => ({ value: m, label: m }))}
                  />
                  <Btn className="!px-2" onClick={() => void refreshModels()} title={t("settings.retry")} aria-label={t("settings.retry")}>
                    <RefreshCw size={15} />
                  </Btn>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12.5px] text-red-400">{modelsError ?? t("settings.modelsEmpty")}</span>
                  <Btn onClick={() => void refreshModels()}>
                    <RefreshCw size={13} />
                    {t("settings.retry")}
                  </Btn>
                </div>
              ))}
          </Row>

          <Row
            title={ru ? rt("ID модели вручную") : "Manual model ID"}
            hint={ru ? rt("Если модели нет в списке, укажите точный ID из документации провайдера. Доступность проверяется при отправке запроса.") : "If a model is missing, enter its exact provider ID. Availability is checked when sending a request."}
          >
            <form className="space-y-2" onSubmit={(e) => {
              e.preventDefault();
              try {
                setModel(normalizeModelId(manualModel));
                setModelError(false);
              } catch {
                setModelError(true);
              }
            }}>
              <input
                aria-label={ru ? rt("ID модели вручную") : "Manual model ID"}
                aria-invalid={modelError}
                value={manualModel}
                onChange={(e) => { setManualModel(e.target.value); setModelError(false); }}
                placeholder="provider/model-id"
                autoComplete="off"
                spellCheck={false}
                className={inputClass}
              />
              <Btn type="submit" variant="primary" disabled={!manualModel.trim() || manualModel.trim() === model}>
                {t("settings.save")}
              </Btn>
              {modelError && <p role="alert" className="text-[12.5px] text-red-400">{ru ? rt("Укажите ID до 256 символов без пробелов и управляющих символов.") : "Enter an ID up to 256 characters, without spaces or control characters."}</p>}
              {model && <p role="status" className="break-all text-[12.5px] text-ink-300">{ru ? rt("Выбрана модель:") : "Selected model:"} {model}</p>}
            </form>
          </Row>

          {hasKey && (
            <Row
              title={t("settings.test")}
              hint={
                testResult ? (
                  <span className={"break-all " + (testResult.ok ? "text-ink-300" : "text-red-400")}>{testResult.message}</span>
                ) : undefined
              }
            >
              <Btn onClick={() => void runTest()} disabled={testing}>
                {testing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                {testing ? t("settings.testing") : t("settings.test")}
              </Btn>
            </Row>
          )}
        </Section>

        {message && <p className="-mt-4 mb-8 px-1 text-[13px] text-ink-300">{message}</p>}

        {cliToolsList.length > 0 && (
          <Section title={t("cli.detected")}>
            {cliToolsList.map((tool) => (
              <Row
                key={tool.id}
                title={tool.name}
                hint={tool.api_key ? t("cli.keyFound") : t("cli.keyNotFound")}
              >
                {tool.api_key && (
                  <Btn
                    disabled={cliBusy}
                    onClick={async () => {
                      setCliBusy(true);
                      try {
                        await useCliTool(tool);
                      } catch (e) {
                        setMessage(String(e));
                      } finally {
                        setCliBusy(false);
                      }
                    }}
                  >
                    <Download size={14} />
                    {t("cli.use")}
                  </Btn>
                )}
              </Row>
            ))}
          </Section>
        )}

        <p className="px-1 text-[12.5px] leading-5 text-ink-500">
          {t("settings.keyStorageNote1")} {t("settings.keyStorageNote2")}
        </p>
            </>
          )}
          {page === "memory" && <MemorySection />}
          {page === "rules" && <RulesSection />}
          {page === "voice" && <VoiceSettings ru={ru} />}
          {page === "mcp" && <McpSection />}
          {page === "lsp" && <LspSection />}
          {page === "local" && <LocalModelsSection />}
          {page === "notifications" && <NotificationsSection />}
          {page === "updates" && <UpdatesSection />}
          {page === "index" && <CodeIndexSection />}
          {page === "skills" && (
            <>
              <AgentSkillsSection />
              <SkillsSection />
            </>
          )}
          {EXTENSIONS_ENABLED && page === "extensions" && <ExtensionsSection />}
          {page === "appearance" && (
            <>
        <Section title={t("settings.theme")}>
          <Row title={t("settings.theme")} hint={t("settings.themeDark")} />
          <Row
            title={ru ? rt("Анимации") : "Animations"}
            hint={ru ? rt("Переходы между режимами, панелями и вкладками, всплывающие меню, эффекты кнопок.") : "Transitions between modes, panels and tabs, popping menus, button effects."}
          >
            <Select
              variant="field"
              value={motion}
              onChange={(v) => {
                const next = v as MotionPref;
                setMotion(next);
                setMotionPref(next);
              }}
              options={[
                { value: "system", label: ru ? rt("Как в Windows") : "Follow Windows" },
                { value: "on", label: ru ? rt("Всегда включены") : "Always on" },
                { value: "off", label: ru ? rt("Выключены") : "Off" },
              ]}
            />
          </Row>
          <Row title={t("settings.language")}>
            <Select
              variant="field"
              value={lang}
              onChange={(v) => setLang(v as Lang)}
              options={LANGUAGES.map((l) => ({ value: l.id, label: l.label }))}
            />
          </Row>
        </Section>
            </>
          )}
          {page === "terminal" && <TerminalSettings ru={ru} />}
          {page === "hotkeys" && <HotkeysSection ru={ru} />}
        </div>
      </div>
    </div>
  );
}
