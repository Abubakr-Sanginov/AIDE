import { isRuLike } from "@/i18n/ruLike";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, CircleAlert, Eraser, Info, Maximize2, Minimize2, Plus, RotateCcw, X } from "lucide-react";
import { MAX_TERMINALS, SHELL_LABEL, useTerminal } from "@/stores/terminal";
import { useUi, type DockTab } from "@/stores/ui";
import { useAi } from "@/stores/ai";
import { useTabs } from "@/stores/tabs";
import { useI18n } from "@/i18n";
import { useExtHost } from "@/features/exthost/store";
import { basename } from "@/lib/fsUtils";
import { attachTerm, fitTerm } from "@/features/terminal/xterms";
import { Indicator, useIndicator } from "@/ui/Indicator";

const TEXT = {
  ru: {
    problems: "Проблемы",
    output: "Вывод",
    terminal: "Терминал",
    agent: "Агент",
    noProblems: "Проблем не обнаружено.",
    noOutput: "Вывода пока нет. Его создают расширения и хост расширений.",
    noAgent: "Агент пока ничего не запускал.",
    hostLog: "Хост расширений",
    newTerm: "Новый терминал",
    restart: "Перезапустить",
    clear: "Очистить",
    expand: "Развернуть",
    shrink: "Свернуть",
    close: "Закрыть панель",
    running: "выполняется",
    done: "готово",
    failed: "ошибка",
    denied: "отклонено",
  },
  en: {
    problems: "Problems",
    output: "Output",
    terminal: "Terminal",
    agent: "Agent",
    noProblems: "No problems detected.",
    noOutput: "No output yet. Extensions and the extension host write here.",
    noAgent: "The agent has not run anything yet.",
    hostLog: "Extension host",
    newTerm: "New terminal",
    restart: "Restart",
    clear: "Clear",
    expand: "Expand",
    shrink: "Shrink",
    close: "Close panel",
    running: "running",
    done: "done",
    failed: "failed",
    denied: "denied",
  },
  tg: {
    problems: "Мушкилот",
    output: "Баромад",
    terminal: "Терминал",
    agent: "Агент",
    noProblems: "Мушкилот ёфт нашуд.",
    noOutput: "Ҳоло баромад нест. Онро васеъшавиҳо ва хости васеъшавиҳо эҷод мекунанд.",
    noAgent: "Агент ҳоло чизеро оғоз накардааст.",
    hostLog: "Хости васеъшавиҳо",
    newTerm: "Терминали нав",
    restart: "Аз нав оғоз кардан",
    clear: "Тоза кардан",
    expand: "Калон кардан",
    shrink: "Хурд кардан",
    close: "Пӯшидани панел",
    running: "иҷро мешавад",
    done: "тайёр",
    failed: "хато",
    denied: "рад шуд",
  },
};

/* ── tabs ── */

function Problems({ L }: { L: typeof TEXT.ru }) {
  const diagnostics = useExtHost((s) => s.diagnostics);
  const rows = useMemo(() => {
    const out: { path: string; line: number; col: number; message: string; severity: number; source?: string }[] = [];
    for (const [key, list] of Object.entries(diagnostics)) {
      const path = key.slice(key.indexOf("\u0000") + 1);
      for (const d of list) out.push({ path, line: d.range[0], col: d.range[1], message: d.message, severity: d.severity, source: d.source });
    }
    return out.sort((a, b) => a.severity - b.severity || a.path.localeCompare(b.path) || a.line - b.line).slice(0, 500);
  }, [diagnostics]);
  if (rows.length === 0) return <div className="px-4 py-3 text-[13px] text-ink-500">{L.noProblems}</div>;
  return (
    <ul className="aide-scroll min-h-0 flex-1 overflow-y-auto py-1">
      {rows.map((r, i) => {
        const Icon = r.severity === 0 ? CircleAlert : r.severity === 1 ? AlertTriangle : Info;
        const tone = r.severity === 0 ? "text-red-400" : r.severity === 1 ? "text-amber-300" : "text-sky-300";
        return (
          <li key={i}>
            <button onClick={() => void useTabs.getState().goto(r.path, r.line + 1, r.col + 1)} className="flex w-full items-start gap-2 px-4 py-1 text-left text-[13px] hover:bg-white/[0.05]">
              <Icon size={14} className={"mt-0.5 shrink-0 " + tone} />
              <span className="min-w-0 flex-1 truncate text-ink-200">{r.message}</span>
              <span className="shrink-0 text-ink-500">
                {basename(r.path)}:{r.line + 1}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Output({ L }: { L: typeof TEXT.ru }) {
  const outputs = useExtHost((s) => s.outputs);
  const logs = useExtHost((s) => s.logs);
  const [name, setName] = useState<string | null>(null);
  const channels = [...Object.keys(outputs), ...(logs.length > 0 ? [L.hostLog] : [])];
  const current = name && channels.includes(name) ? name : channels[0];
  const text = current === L.hostLog ? logs.join("\n") : outputs[current ?? ""] ?? "";
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text.length, current]);
  if (channels.length === 0) return <div className="px-4 py-3 text-[13px] text-ink-500">{L.noOutput}</div>;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 gap-1 px-3 pb-1">
        {channels.map((c) => (
          <button key={c} aria-pressed={c === current} onClick={() => setName(c)} className="h-6 rounded-md px-2 text-[12px] text-ink-400 hover:text-ink-50 aria-pressed:bg-white/[0.08] aria-pressed:text-ink-50">
            {c}
          </button>
        ))}
      </div>
      <pre ref={ref} className="aide-scroll min-h-0 flex-1 select-text overflow-auto whitespace-pre-wrap break-words px-4 pb-2 font-mono text-[12px] leading-5 text-ink-300">{text}</pre>
    </div>
  );
}

function AgentLog({ L }: { L: typeof TEXT.ru }) {
  const messages = useAi((s) => s.messages);
  const events = useMemo(() => messages.flatMap((m) => m.tools ?? []).slice(-200), [messages]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);
  if (events.length === 0) return <div className="px-4 py-3 text-[13px] text-ink-500">{L.noAgent}</div>;
  const label = (s: string) => (s === "running" ? L.running : s === "ok" ? L.done : s === "denied" ? L.denied : L.failed);
  return (
    <div ref={ref} className="aide-scroll min-h-0 flex-1 overflow-y-auto py-1">
      {events.map((e, i) => (
        <div key={i} className="flex items-start gap-2 px-4 py-1 font-mono text-[12px]">
          <span className={"shrink-0 " + (e.status === "ok" ? "text-emerald-400" : e.status === "running" ? "text-teal-300" : "text-red-400")}>{label(e.status)}</span>
          <span className="shrink-0 text-ink-100">{e.tool}</span>
          <span className="min-w-0 flex-1 truncate text-ink-500">{e.args.replace(/\s+/g, " ")}</span>
        </div>
      ))}
    </div>
  );
}

function TerminalBody({ id }: { id: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    attachTerm(id, host);
    const ro = new ResizeObserver(() => fitTerm(id));
    ro.observe(host);
    return () => ro.disconnect();
  }, [id]);
  // Padding sits on the outer box: the fit addon measures the host's border-box, so padding on the host itself
  // makes the grid larger than the visible area and the last rows / right columns get cut off.
  return (
    <div className="min-h-0 flex-1 px-4 pb-2">
      <div ref={hostRef} className="h-full w-full overflow-hidden" onMouseDown={(e) => e.stopPropagation()} />
    </div>
  );
}

/** Row of terminal tabs: scrolls sideways, so 100 of them stay usable. */
function TerminalTabs() {
  const sessions = useTerminal((s) => s.sessions);
  const activeId = useTerminal((s) => s.activeId);
  const activeRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [activeId, sessions.length]);
  return (
    <div role="tablist" className="aide-scroll flex h-8 shrink-0 items-center gap-1 overflow-x-auto px-4">
      {sessions.map((x) => {
        const on = x.id === activeId;
        return (
          <span
            key={x.id}
            ref={on ? activeRef : undefined}
            className={"aide-pop flex h-7 shrink-0 items-center gap-1.5 rounded-lg pl-2.5 pr-1 text-[12.5px] transition-colors " + (on ? "bg-white/[0.07] text-ink-50" : "text-ink-400 hover:text-ink-100")}
          >
            <button role="tab" aria-selected={on} onClick={() => useTerminal.getState().select(x.id)} className="flex items-center gap-1.5">
              <span className={"size-1.5 rounded-full " + (x.alive ? "bg-emerald-400" : "bg-ink-600")} />
              {x.title}
            </button>
            <button aria-label="Close" onClick={() => void useTerminal.getState().close(x.id)} className="rounded p-0.5 text-ink-500 hover:bg-white/[0.1] hover:text-ink-100">
              <X size={12} />
            </button>
          </span>
        );
      })}
    </div>
  );
}

/** "+" opens a tab with the last used shell; the chevron picks another installed shell. */
function NewTerminalButton({ title }: { title: string }) {
  const shells = useTerminal((s) => s.shells);
  const count = useTerminal((s) => s.sessions.length);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const full = count >= MAX_TERMINALS;
  return (
    <div ref={ref} className="relative flex items-center">
      <button title={title} aria-label={title} disabled={full} onClick={() => void useTerminal.getState().create()} className="aide-icon-button size-7 disabled:opacity-40">
        <Plus size={15} />
      </button>
      <button aria-label="Shell" aria-expanded={open} disabled={full} onClick={() => setOpen((v) => !v)} className="aide-icon-button -ml-1 h-7 w-5 disabled:opacity-40">
        <ChevronDown size={12} />
      </button>
      {open && (
        <div role="menu" className="aide-pop absolute bottom-full right-0 z-30 mb-1 min-w-[180px] rounded-xl border border-line/60 bg-ink-900 p-1 shadow-xl">
          {shells.map((k) => (
            <button
              key={k}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void useTerminal.getState().create(k);
              }}
              className="flex h-8 w-full items-center rounded-lg px-3 text-left text-[13px] text-ink-200 hover:bg-white/[0.07]"
            >
              {SHELL_LABEL[k]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Bottom dock: Problems / Output / Terminal / Agent. */
export function TerminalPanel() {
  const { lang } = useI18n();
  const L = lang === "tg" ? TEXT.tg : isRuLike(lang) ? TEXT.ru : TEXT.en;
  const tab = useUi((s) => s.dockTab);
  const setTab = useUi((s) => s.setDockTab);
  const height = useUi((s) => s.terminalHeight);
  const setHeight = useUi((s) => s.setTerminalHeight);
  const toggle = useUi((s) => s.toggleTerminal);
  const activeId = useTerminal((s) => s.activeId);
  const dockIndicator = useIndicator(tab);
  useEffect(() => {
    if (tab === "terminal") void useTerminal.getState().ensure();
  }, [tab]);
  const problemCount = useExtHost((s) => Object.values(s.diagnostics).reduce((n, l) => n + l.length, 0));
  const [prevHeight, setPrevHeight] = useState<number | null>(null);

  const tabs: { id: DockTab; label: string; badge?: number }[] = [
    { id: "problems", label: L.problems, badge: problemCount || undefined },
    { id: "output", label: L.output },
    { id: "terminal", label: L.terminal },
    { id: "agent", label: L.agent },
  ];
  const expanded = prevHeight !== null;

  return (
    <div className="aide-vt-dock flex shrink-0 select-none flex-col" style={{ height }}>
      <div className="flex h-11 shrink-0 items-center gap-1 px-4">
        <div ref={dockIndicator.ref} role="tablist" className="relative isolate flex items-center gap-1">
        <Indicator box={dockIndicator.box} radius={8} />
        {tabs.map((x) => (
          <button
            key={x.id}
            role="tab"
            aria-selected={tab === x.id}
            onClick={() => setTab(x.id)}
            className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-[14px] font-medium text-ink-400 transition-colors hover:text-ink-50 aria-selected:text-ink-50"
          >
            {x.label}
            {x.badge && <span key={x.badge} className="aide-bump rounded-full bg-white/[0.12] px-1.5 text-[11px] text-ink-200">{x.badge}</span>}
          </button>
        ))}
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          {tab === "terminal" && (
            <>
              <NewTerminalButton title={L.newTerm} />
              <button
                title={L.restart}
                aria-label={L.restart}
                disabled={!activeId}
                onClick={() => activeId && void useTerminal.getState().restart(activeId)}
                className="aide-icon-button size-7 disabled:opacity-40"
              >
                <RotateCcw size={14} />
              </button>
              <button title={L.clear} aria-label={L.clear} disabled={!activeId} onClick={() => activeId && useTerminal.getState().clear(activeId)} className="aide-icon-button size-7 disabled:opacity-40">
                <Eraser size={14} />
              </button>
            </>
          )}
          <button
            title={expanded ? L.shrink : L.expand}
            aria-label={expanded ? L.shrink : L.expand}
            onClick={() => {
              if (expanded) {
                setHeight(prevHeight);
                setPrevHeight(null);
              } else {
                setPrevHeight(height);
                setHeight(480);
              }
            }}
            className="aide-icon-button size-7"
          >
            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button title={L.close} aria-label={L.close} onClick={toggle} className="aide-icon-button size-7">
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="aide-vt-dock-body flex min-h-0 flex-1 flex-col">
      {tab === "problems" && <div className="flex min-h-0 flex-1 flex-col"><Problems L={L} /></div>}
      {tab === "output" && <div className="flex min-h-0 flex-1 flex-col"><Output L={L} /></div>}
      {tab === "terminal" && (
        <>
          <TerminalTabs />
          {activeId && <TerminalBody key={activeId} id={activeId} />}
        </>
      )}
      {tab === "agent" && <div className="flex min-h-0 flex-1 flex-col"><AgentLog L={L} /></div>}
      </div>
    </div>
  );
}
