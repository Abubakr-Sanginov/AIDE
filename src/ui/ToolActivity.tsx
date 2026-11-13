import { rt } from "@/i18n/tgMap";
import { isRuLike } from "@/i18n/ruLike";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { useI18n } from "@/i18n";

/** One agent action, whatever produced it (AIDE agent, crew role). */
export interface Activity {
  tool: string;
  /** JSON (or plain text) of the call's arguments. */
  args: string;
  result?: string;
  status: "running" | "ok" | "error" | "denied";
  /** Custom expanded body (e.g. a diff); replaces the default args/result view. */
  detail?: ReactNode;
}

type Verbs = { now: string; past: string };

const VERBS: Record<string, { ru: Verbs; en: Verbs }> = {
  read_file: { ru: { now: "Читаю", past: "Прочитал" }, en: { now: "Reading", past: "Read" } },
  write_file: { ru: { now: "Записываю", past: "Записал" }, en: { now: "Writing", past: "Wrote" } },
  create_file: { ru: { now: "Создаю", past: "Создал" }, en: { now: "Creating", past: "Created" } },
  apply_edit: { ru: { now: "Правлю", past: "Изменил" }, en: { now: "Editing", past: "Edited" } },
  delete_file: { ru: { now: "Удаляю", past: "Удалил" }, en: { now: "Deleting", past: "Deleted" } },
  list_dir: { ru: { now: "Смотрю папку", past: "Посмотрел папку" }, en: { now: "Listing", past: "Listed" } },
  get_tree: { ru: { now: "Смотрю структуру", past: "Посмотрел структуру" }, en: { now: "Scanning", past: "Scanned" } },
  search_files: { ru: { now: "Ищу", past: "Искал" }, en: { now: "Searching", past: "Searched" } },
  run_terminal_command: { ru: { now: "Выполняю", past: "Выполнил" }, en: { now: "Running", past: "Ran" } },
  auto_check: { ru: { now: "Проверяю проект", past: "Проверил проект" }, en: { now: "Checking the project", past: "Checked the project" } },
  get_diagnostics: { ru: { now: "Смотрю ошибки", past: "Посмотрел ошибки" }, en: { now: "Reading errors", past: "Read errors" } },
  search_code: { ru: { now: "Ищу по коду", past: "Искал по коду" }, en: { now: "Searching the code", past: "Searched the code" } },
  find_symbol: { ru: { now: "Ищу определение", past: "Искал определение" }, en: { now: "Finding a definition", past: "Found a definition" } },
  project_map: { ru: { now: "Смотрю карту проекта", past: "Посмотрел карту проекта" }, en: { now: "Reading the project map", past: "Read the project map" } },
  sessions: { ru: { now: "Смотрю сессии", past: "Посмотрел сессии" }, en: { now: "Checking sessions", past: "Checked sessions" } },
  browse_page: { ru: { now: "Открываю", past: "Открыл" }, en: { now: "Opening", past: "Opened" } },
  computer_screenshot: { ru: { now: "Смотрю на экран", past: "Посмотрел на экран" }, en: { now: "Looking at the screen", past: "Looked at the screen" } },
  computer_click: { ru: { now: "Кликаю", past: "Кликнул" }, en: { now: "Clicking", past: "Clicked" } },
  computer_move: { ru: { now: "Двигаю курсор", past: "Подвинул курсор" }, en: { now: "Moving the cursor", past: "Moved the cursor" } },
  computer_drag: { ru: { now: "Перетаскиваю", past: "Перетащил" }, en: { now: "Dragging", past: "Dragged" } },
  computer_scroll: { ru: { now: "Прокручиваю", past: "Прокрутил" }, en: { now: "Scrolling", past: "Scrolled" } },
  computer_type: { ru: { now: "Печатаю", past: "Напечатал" }, en: { now: "Typing", past: "Typed" } },
  computer_key: { ru: { now: "Нажимаю", past: "Нажал" }, en: { now: "Pressing", past: "Pressed" } },
  computer_wait: { ru: { now: "Жду", past: "Подождал" }, en: { now: "Waiting", past: "Waited" } },
  computer_windows: { ru: { now: "Смотрю окна", past: "Посмотрел окна" }, en: { now: "Listing windows", past: "Listed windows" } },
  computer_focus_window: { ru: { now: "Открываю окно", past: "Открыл окно" }, en: { now: "Focusing a window", past: "Focused a window" } },
  computer_open: { ru: { now: "Запускаю", past: "Запустил" }, en: { now: "Launching", past: "Launched" } },
};

function parse(args: string): Record<string, unknown> {
  try {
    const v = JSON.parse(args);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** What the action is about: a path, a command, a query. */
export function targetOf(a: Activity): string {
  const o = parse(a.args);
  const pick = (...keys: string[]) => {
    for (const k of keys) if (typeof o[k] === "string" && o[k]) return o[k] as string;
    return "";
  };
  if (typeof o.x === "number" && typeof o.y === "number") return `(${Math.round(o.x)}, ${Math.round(o.y)})`;
  const raw = pick("command", "path", "file_path", "query", "pattern", "url", "name", "keys", "text", "title", "target");
  return clip(raw.replace(/\s+/g, " ").trim(), 70);
}

function verbOf(tool: string, lang: "ru" | "en", running: boolean): string {
  const v = VERBS[tool]?.[lang];
  if (v) return lang === "ru" ? rt(running ? v.now : v.past) : running ? v.now : v.past;
  return tool;
}

function Dots({ spinning }: { spinning: boolean }) {
  // Four dots that take turns; static and dim once the work is over.
  return (
    <span aria-hidden className={"relative inline-block size-4 shrink-0 " + (spinning ? "animate-spin [animation-duration:1.6s]" : "opacity-50")}>
      <span className="absolute left-1/2 top-0 size-1 -translate-x-1/2 rounded-full bg-accent" />
      <span className="absolute bottom-0 left-1/2 size-1 -translate-x-1/2 rounded-full bg-accent" />
      <span className="absolute left-0 top-1/2 size-1 -translate-y-1/2 rounded-full bg-accent" />
      <span className="absolute right-0 top-1/2 size-1 -translate-y-1/2 rounded-full bg-accent" />
    </span>
  );
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  return m > 0 ? `${m}m ${sec % 60}s` : `${sec}s`;
}

function Row({ a, lang }: { a: Activity; lang: "ru" | "en" }) {
  const [open, setOpen] = useState(false);
  const target = targetOf(a);
  const running = a.status === "running";
  const tone = a.status === "error" ? "text-red-400" : a.status === "denied" ? "text-accent" : "text-ink-50";
  const pretty = (() => {
    try {
      return JSON.stringify(JSON.parse(a.args), null, 2);
    } catch {
      return a.args;
    }
  })();
  return (
    <div className="aide-slide-in border-b border-line/50 last:border-b-0">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-white/[0.03]">
        <span className="shrink-0 text-ink-500">{verbOf(a.tool, lang, running)}</span>
        <span className={"min-w-0 truncate " + tone}>{target || a.tool}</span>
        {a.status === "error" && <span className="shrink-0 text-[11px] text-red-400">{isRuLike(lang) ? rt("ошибка") : "failed"}</span>}
        {a.status === "denied" && <span className="shrink-0 text-[11px] text-accent">{isRuLike(lang) ? rt("отклонено") : "denied"}</span>}
        <ChevronRight size={12} className={"ml-auto shrink-0 text-ink-500 transition-transform duration-150 " + (open ? "rotate-90" : "")} />
      </button>
      {open && (
        <div className="aide-fade-in space-y-2 px-3 pb-2.5">
          {a.detail}
          {!a.detail && pretty && <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-canvas p-2 font-mono text-[11.5px] leading-4 text-ink-300">{pretty}</pre>}
          {!a.detail && a.result && <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-canvas p-2 font-mono text-[11.5px] leading-4 text-ink-300">{clip(a.result, 6000)}</pre>}
        </div>
      )}
    </div>
  );
}

/**
 * A group of consecutive actions as one line: "Running cd 1m 9s ▸". While something runs the line
 * names it and counts seconds and stays one click from the list; when everything is done it
 * summarises ("Выполнено 3 действия"). The list holds one expandable row per action.
 */
export function ToolActivity({ items, live }: { items: Activity[]; live?: boolean }) {
  const { lang: l } = useI18n();
  const lang = isRuLike(l) ? "ru" : "en";
  const tg = l === "tg";
  const [open, setOpen] = useState(false);
  const last = items[items.length - 1];
  const running = !!live && items.some((x) => x.status === "running");
  const current = [...items].reverse().find((x) => x.status === "running") ?? last;

  const startRef = useRef(Date.now());
  const [sec, setSec] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setSec(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  if (items.length === 0) return null;
  const failed = items.filter((x) => x.status === "error").length;
  const n = items.length;
  const word = tg ? "амал" : isRuLike(lang) ? (n % 10 === 1 && n % 100 !== 11 ? "действие" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "действия" : "действий") : n === 1 ? "action" : "actions";
  const head = running
    ? `${verbOf(current.tool, lang, true)} ${targetOf(current).split(" ")[0] || ""}`.trim()
    : `${isRuLike(lang) ? rt("Выполнено") : "Done"}: ${n} ${word}${failed ? (tg ? `, хатоҳо: ${failed}` : isRuLike(lang) ? `, ошибок: ${failed}` : `, ${failed} failed`) : ""}`;

  return (
    <div className="my-1.5">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex items-center gap-2.5 py-1 text-[13.5px] text-ink-300 hover:text-ink-100">
        <Dots spinning={running} />
        <span>{head}</span>
        {running && <span className="text-ink-500">{fmt(sec)}</span>}
        <ChevronRight size={12} className={"shrink-0 text-ink-500 transition-transform duration-150 " + (open ? "rotate-90" : "")} />
      </button>
      {open && (
        <div className="aide-pop mt-1 overflow-hidden rounded-xl border border-line bg-white/[0.02]">
          {items.map((a, i) => (
            <Row key={`${a.tool}-${i}`} a={a} lang={lang} />
          ))}
        </div>
      )}
    </div>
  );
}
