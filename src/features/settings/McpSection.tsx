import { isRuLike } from "@/i18n/ruLike";
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ChevronDown, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useI18n } from "@/i18n";
import { Btn, Row, Section, inputClass } from "@/features/settings/SettingsPanel";

interface McpServer {
  id: string;
  name: string;
  command: string;
  args: string[];
  envKeys: string[];
  enabled: boolean;
  status: "stopped" | "starting" | "running" | "failed";
  error: string;
  log: string;
  tools: { name: string; description: string }[];
}

// Versions are pinned: `npx -y name@version` runs exactly that release, not whatever is newest today.
const PRESETS: { name: string; command: string; args: string[]; ru: string; en: string; tg: string }[] = [
  {
    name: "Memory",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory@2.1.0"],
    ru: "Память агента: граф знаний между сессиями",
    en: "Agent memory: a knowledge graph across sessions",
    tg: "Хотираи агент: графи донишҳо байни ҷаласаҳо",
  },
  {
    name: "Sequential Thinking",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking@2.1.1"],
    ru: "Пошаговое рассуждение для сложных задач",
    en: "Step-by-step reasoning for hard tasks",
    tg: "Андешаи қадам ба қадам барои вазифаҳои мураккаб",
  },
  {
    name: "Playwright",
    command: "npx",
    args: ["-y", "@playwright/mcp@0.0.84"],
    ru: "Управление настоящим браузером: клики, формы, скриншоты",
    en: "Drive a real browser: clicks, forms, screenshots",
    tg: "Идораи браузери ҳақиқӣ: пахшҳо, шаклҳо, аксҳои экран",
  },
];

const TEXT = {
  ru: {
    servers: "Серверы",
    none: "Серверов пока нет. Добавьте готовый ниже или свой.",
    presets: "Готовые",
    preset: "Добавить",
    custom: "Свой сервер",
    customHint: "Любая программа с поддержкой MCP по stdio: команда и аргументы, по одному на строку.",
    name: "Название",
    command: "Команда (например, npx)",
    args: "Аргументы, по одному на строку",
    env: "Переменные окружения, KEY=значение по строке (хранятся в защищённом хранилище)",
    save: "Добавить сервер",
    cancel: "Отмена",
    notice:
      "Сервер MCP это программа, которую AIDE запускает на вашем компьютере с вашими правами. Добавляйте только то, чему доверяете. Агент использует инструменты серверов в режиме «Агент», а в режиме «Авто» спрашивает разрешение на каждый вызов. Результаты серверов агент считает данными, а не инструкциями. Поддерживаются локальные серверы (stdio).",
    status: { stopped: "остановлен", starting: "запускается…", running: "работает", failed: "ошибка" },
    tools: "Инструменты",
    log: "Журнал сервера",
    restart: "Перезапустить",
    remove: "Удалить",
    keysSet: "Переменные",
  },
  en: {
    servers: "Servers",
    none: "No servers yet. Add a ready-made one below or your own.",
    presets: "Ready-made",
    preset: "Add",
    custom: "Your own server",
    customHint: "Any MCP program over stdio: a command and its arguments, one per line.",
    name: "Name",
    command: "Command (for example npx)",
    args: "Arguments, one per line",
    env: "Environment variables, KEY=value per line (kept in the credential store)",
    save: "Add server",
    cancel: "Cancel",
    notice:
      "An MCP server is a program AIDE runs on your computer with your permissions. Only add what you trust. The agent uses server tools in Agent mode and asks before each call in Auto mode. The agent treats server results as data, not instructions. Local (stdio) servers are supported.",
    status: { stopped: "stopped", starting: "starting…", running: "running", failed: "failed" },
    tools: "Tools",
    log: "Server log",
    restart: "Restart",
    remove: "Delete",
    keysSet: "Variables",
  },
  tg: {
    servers: "Серверҳо",
    none: "Ҳоло сервер нест. Сервери тайёр ё шахсиро дар поён илова кунед.",
    presets: "Тайёрҳо",
    preset: "Илова кардан",
    custom: "Сервери шахсӣ",
    customHint: "Ҳар барномаи дорои дастгирии MCP тавассути stdio: фармон ва аргументҳо, ҳар кадом дар сатри алоҳида.",
    name: "Ном",
    command: "Фармон (масалан, npx)",
    args: "Аргументҳо, ҳар кадом дар сатри алоҳида",
    env: "Тағйирёбандаҳои муҳит, KEY=қимат дар ҳар сатр (дар захиракунҷои ҳимояшуда нигоҳ дошта мешаванд)",
    save: "Илова кардани сервер",
    cancel: "Бекор кардан",
    notice:
      "Сервери MCP барномаест, ки AIDE онро дар компютери шумо бо ҳуқуқҳои шумо иҷро мекунад. Танҳо чизеро илова кунед, ки ба он боварӣ доред. Агент дар ҳолати «Агент» воситаҳои серверҳоро истифода мебарад, ва дар ҳолати «Худкор» пеш аз ҳар даъват иҷозат мепурсад. Натиҷаҳои серверҳоро агент ҳамчун маълумот мешуморад, на ҳамчун дастур. Серверҳои маҳаллӣ (stdio) дастгирӣ мешаванд.",
    status: { stopped: "қатъ шуд", starting: "оғоз мешавад…", running: "кор мекунад", failed: "хато" },
    tools: "Воситаҳо",
    log: "Рӯзномаи сервер",
    restart: "Аз нав оғоз кардан",
    remove: "Нест кардан",
    keysSet: "Тағйирёбандаҳо",
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

function parseEnv(text: string): Record<string, string> | string {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const i = t.indexOf("=");
    const key = i > 0 ? t.slice(0, i).trim() : "";
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) return `KEY=value: ${t.slice(0, 40)}`;
    out[key] = t.slice(i + 1).trim();
  }
  return out;
}

export function McpSection() {
  const { lang } = useI18n();
  const L = lang === "tg" ? TEXT.tg : isRuLike(lang) ? TEXT.ru : TEXT.en;
  const [servers, setServers] = useState<McpServer[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [env, setEnv] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void invoke<McpServer[]>("mcp_list")
      .then((list) => setServers(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    let off: (() => void) | undefined;
    void listen("mcp-status", refresh).then((f) => (off = f));
    return () => off?.();
  }, [refresh]);

  const save = async (s: { name: string; command: string; args: string[]; env: Record<string, string> }) => {
    setBusy(true);
    setError("");
    try {
      await invoke("mcp_save", { request: { ...s, enabled: true } });
      refresh();
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submitCustom = async () => {
    const parsed = parseEnv(env);
    if (typeof parsed === "string") return setError(parsed);
    const list = args.split("\n").map((a) => a.trim()).filter(Boolean);
    if (await save({ name, command, args: list, env: parsed })) {
      setName("");
      setCommand("");
      setArgs("");
      setEnv("");
      setFormOpen(false);
    }
  };

  const act = (fn: string, payload: Record<string, unknown>) => void invoke(fn, payload).then(refresh).catch((e) => setError(String(e)));
  const statusTone = (s: McpServer["status"]) => (s === "running" ? "text-emerald-400" : s === "failed" ? "text-red-400" : "text-ink-400");

  return (
    <>
      <Section title={L.servers}>
        {servers.length === 0 && <div className="px-5 py-4 text-[13px] text-ink-400">{L.none}</div>}
        {servers.map((s) => (
          <div key={s.id}>
            <Row
              title={s.name}
              hint={
                <span>
                  <span className={statusTone(s.status)}>{L.status[s.status]}</span>
                  {s.status === "running" && ` · ${s.tools.length} ${L.tools.toLowerCase()}`}
                  <span className="ml-2 font-mono text-[11.5px] text-ink-600">
                    {s.command} {s.args.join(" ").slice(0, 80)}
                  </span>
                </span>
              }
            >
              <div className="flex items-center justify-end gap-2">
                {s.status === "starting" && <Loader2 size={14} className="animate-spin text-ink-400" />}
                <Btn className="!px-2" title={L.restart} aria-label={L.restart} onClick={() => act("mcp_restart", { id: s.id })}>
                  <RefreshCw size={14} />
                </Btn>
                <Btn variant="danger" className="!px-2" title={L.remove} aria-label={L.remove} onClick={() => act("mcp_remove", { id: s.id })}>
                  <Trash2 size={15} />
                </Btn>
                <button onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={open === s.id} aria-label={L.tools} className="aide-icon-button size-8">
                  <ChevronDown size={15} className={open === s.id ? "rotate-180" : ""} />
                </button>
                <Switch on={s.enabled} onChange={() => act("mcp_set_enabled", { id: s.id, enabled: !s.enabled })} label={s.name} />
              </div>
            </Row>
            {s.error && <div className="px-5 pb-3 text-[12.5px] leading-5 text-red-400">{s.error}</div>}
            {open === s.id && (
              <div className="space-y-3 bg-canvas/40 px-5 py-3">
                {s.envKeys.length > 0 && (
                  <div className="text-[12.5px] text-ink-400">
                    {L.keysSet}: <span className="font-mono">{s.envKeys.join(", ")}</span>
                  </div>
                )}
                {s.tools.length > 0 && (
                  <ul className="space-y-1">
                    {s.tools.map((t) => (
                      <li key={t.name} className="text-[12.5px] leading-5">
                        <span className="font-mono text-ink-100">{t.name}</span>
                        {t.description && <span className="text-ink-500"> — {t.description.slice(0, 140)}</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {s.log.trim() && (
                  <div>
                    <div className="mb-1 text-[12px] uppercase tracking-wide text-ink-500">{L.log}</div>
                    <pre className="aide-scroll max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/30 p-2 font-mono text-[11.5px] leading-4 text-ink-400">{s.log}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </Section>

      <Section title={L.presets}>
        {PRESETS.map((p) => {
          const added = servers.some((s) => s.command === p.command && s.args.join(" ") === p.args.join(" "));
          return (
            <Row key={p.name} title={p.name} hint={lang === "tg" ? p.tg : isRuLike(lang) ? p.ru : p.en}>
              <div className="flex justify-end">
                <Btn disabled={busy || added} onClick={() => void save({ name: p.name, command: p.command, args: p.args, env: {} })}>
                  <Plus size={14} />
                  {L.preset}
                </Btn>
              </div>
            </Row>
          );
        })}
        <Row title={L.custom} hint={L.customHint}>
          <div className="flex justify-end">
            <Btn onClick={() => setFormOpen((v) => !v)}>
              <Plus size={14} />
              {L.custom}
            </Btn>
          </div>
        </Row>
        {formOpen && (
          <div className="space-y-2.5 bg-canvas/40 px-5 py-4">
            <input value={name} maxLength={60} placeholder={L.name} onChange={(e) => setName(e.target.value)} className={inputClass} />
            <input value={command} maxLength={260} spellCheck={false} placeholder={L.command} onChange={(e) => setCommand(e.target.value)} className={inputClass} />
            <textarea
              value={args}
              rows={3}
              spellCheck={false}
              placeholder={L.args}
              onChange={(e) => setArgs(e.target.value)}
              className="w-full resize-y rounded-lg border border-line-strong bg-canvas px-3 py-2 font-mono text-[12.5px] leading-5 text-ink-100 outline-none placeholder:text-ink-500 focus:border-white/30"
            />
            <textarea
              value={env}
              rows={2}
              spellCheck={false}
              autoComplete="off"
              placeholder={L.env}
              onChange={(e) => setEnv(e.target.value)}
              className="w-full resize-y rounded-lg border border-line-strong bg-canvas px-3 py-2 font-mono text-[12.5px] leading-5 text-ink-100 outline-none placeholder:text-ink-500 focus:border-white/30"
            />
            <div className="flex items-center gap-2">
              <Btn variant="primary" disabled={busy || !name.trim() || !command.trim()} onClick={() => void submitCustom()}>
                {L.save}
              </Btn>
              <Btn variant="ghost" onClick={() => setFormOpen(false)}>
                {L.cancel}
              </Btn>
            </div>
          </div>
        )}
        {error && <div className="px-5 py-3 text-[13px] text-red-400">{error}</div>}
        <div className="px-5 py-3 text-[12.5px] leading-5 text-ink-500">{L.notice}</div>
      </Section>
    </>
  );
}
