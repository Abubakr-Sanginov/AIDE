import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Archive, ChevronDown, Eraser, FolderOpen, GitBranch, Laptop, ListChecks } from "lucide-react";
import { rt } from "@/i18n/tgMap";
import { isRuLike } from "@/i18n/ruLike";
import { useI18n } from "@/i18n";
import { historyFor, useAi, type ChatMessage } from "@/stores/ai";
import { useTabs } from "@/stores/tabs";
import { useWorkspace } from "@/stores/workspace";
import { t } from "@/i18n/t";
import { estimateTokens, loadWindow, saveWindow, windowFromModel } from "@/lib/contextSize";
import { latestAgentPlan, parsePlan } from "@/lib/plan";
import { contextApi } from "@/api/context";
import { gitBranches } from "@/api/git";
import { isLocalProvider } from "@/lib/localProviders";
import {
  barWidths,
  buildSegments,
  formatShare,
  formatTokens,
  totalTokens,
  type ContextBreakdown,
  type SegmentKey,
} from "@/lib/contextBreakdown";

/** Colours of the bar and of the legend squares. */
const SEGMENT_COLOR: Record<SegmentKey, string> = {
  messages: "bg-sky-400",
  tools: "bg-orange-400",
  mcpTools: "bg-teal-300",
  prompt: "bg-amber-300",
  skills: "bg-violet-300",
  mcpInstructions: "bg-pink-300",
  memory: "bg-lime-300",
  attachments: "bg-cyan-200",
};

const SEGMENT_LABEL: Record<SegmentKey, { ru: string; en: string }> = {
  messages: { ru: "Сообщения", en: "Messages" },
  tools: { ru: "Инструменты AIDE", en: "System tools" },
  mcpTools: { ru: "Инструменты MCP", en: "MCP tools" },
  prompt: { ru: "Системный промпт", en: "System prompt" },
  skills: { ru: "Навыки", en: "Skills" },
  mcpInstructions: { ru: "Описание серверов MCP", en: "MCP server instructions" },
  memory: { ru: "Память и правила проекта", en: "Memory and project rules" },
  attachments: { ru: "Вложения и файл", en: "Attachments and file" },
};

/** A row that opens a list under it: "MCP tools  167 ›". */
function Disclosure({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 py-1 text-left text-[12.5px] text-ink-400 hover:text-ink-200"
      >
        <ChevronDown size={12} className={"shrink-0 transition-transform " + (open ? "" : "-rotate-90")} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="font-mono text-[11.5px] text-ink-500">{count}</span>
      </button>
      {open && <div className="pb-1 pl-[18px]">{children}</div>}
    </div>
  );
}

/** A picture is not text: one screen-sized image costs about this much of a context window. */
const IMAGE_TOKENS = 1_500;
/** Per-message framing (role, separators) on top of the text itself. */
const MESSAGE_OVERHEAD = 6;

function tokensOfMessage(m: ChatMessage): number {
  let n = estimateTokens(m.content) + MESSAGE_OVERHEAD;
  for (const tool of m.tools ?? []) {
    n += estimateTokens(tool.args) + estimateTokens(tool.result) + 8;
  }
  return n;
}

/** Label on the left, value on the right: the row shape the side panel is built from. */
function Row({ label, value, hint, mono }: { label: string; value: string; hint?: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="min-w-0 shrink text-[12.5px] text-ink-500">{label}</span>
      <span
        className={"min-w-0 truncate text-right text-[12.5px] text-ink-200" + (mono ? " font-mono" : "")}
        title={hint ?? value}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * One collapsible block of the side panel: a quiet label, a divider, the rows under it.
 * Folded blocks stay in place, so the panel keeps its shape from tab to tab.
 */
function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="border-t border-line/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.02]"
      >
        <span className="flex-1 text-[12px] text-ink-400">{title}</span>
        {right}
        <ChevronDown
          size={13}
          className={"shrink-0 text-ink-600 transition-transform " + (open ? "" : "-rotate-90")}
        />
      </button>
      {open && <div className="px-3 pb-2">{children}</div>}
    </section>
  );
}

/**
 * Side panel next to the browser: the environment the request is made in, how full the model
 * window is, the plan the agent wrote, and the two ways to free space — compact or clear.
 */
export function ContextPane() {
  const { lang } = useI18n();
  const messages = useAi((s) => s.messages);
  const attachments = useAi((s) => s.attachments);
  const attachFile = useAi((s) => s.attachFile);
  const model = useAi((s) => s.model);
  const mode = useAi((s) => s.mode);
  const streaming = useAi((s) => s.streaming);
  const compacting = useAi((s) => s.compacting);
  const compact = useAi((s) => s.compact);
  const clear = useAi((s) => s.clear);
  const setMode = useAi((s) => s.setMode);
  const providerId = useAi((s) => s.providerId);
  const localCompact = useAi((s) => s.localCompact);
  const ru = isRuLike(lang);
  const L = (k: SegmentKey) => (ru ? rt(SEGMENT_LABEL[k].ru) : SEGMENT_LABEL[k].en);

  const root = useWorkspace((s) => s.root);
  const tabs = useTabs((s) => s.tabs);
  const activeId = useTabs((s) => s.activeId);
  const active = tabs.find((x) => x.id === activeId);

  // The model name often carries the window ("…-128k"); otherwise the last value the user typed.
  const hint = windowFromModel(model);
  const [win, setWin] = useState(() => hint ?? loadWindow());
  useEffect(() => {
    if (hint) setWin(hint);
  }, [hint]);

  // What AIDE adds to the conversation (prompt, tools, MCP, skills, rules). A plain chat sends none of it.
  const [extra, setExtra] = useState<ContextBreakdown | null>(null);
  const compactMode = isLocalProvider(providerId) && localCompact;
  useEffect(() => {
    if (mode === "chat") {
      setExtra(null);
      return;
    }
    let alive = true;
    const load = () => void contextApi.breakdown(mode, compactMode).then((b) => alive && setExtra(b)).catch(() => alive && setExtra(null));
    load();
    window.addEventListener("focus", load);
    return () => {
      alive = false;
      window.removeEventListener("focus", load);
    };
  }, [mode, compactMode, root]);

  // The branch next to the project.
  const [branch, setBranch] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setBranch(null);
    if (root) {
      void gitBranches(root)
        .then((list) => alive && setBranch(list.find((b) => b.current)?.name ?? null))
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [root]);

  const stats = useMemo(() => {
    const inContext = historyFor(messages);
    const dropped = messages.length - inContext.length;
    const text = inContext.reduce((n, m) => n + tokensOfMessage(m), 0);
    const tools = inContext.reduce((n, m) => n + (m.tools?.length ?? 0), 0);
    const attach = attachments.reduce(
      (n, a) => n + (a.mime.startsWith("image/") ? IMAGE_TOKENS : estimateTokens(a.data)),
      0,
    );
    const file = attachFile && active ? estimateTokens(active.content) : 0;
    return { inContext: inContext.length, dropped, tools, attach, file, text, total: text + attach + file };
  }, [messages, attachments, attachFile, active]);

  const segments = buildSegments(extra, stats.text, stats.attach + stats.file);
  const used = totalTokens(segments);
  const winSize = win > 0 ? win : 1;
  const pct = Math.min(100, Math.round((used / winSize) * 100));
  const widths = barWidths(segments, winSize);
  const free = Math.max(0, win - used);
  const planIdx = messages.map((m) => !!(m.plan && m.content.trim())).lastIndexOf(true);
  // The plan the agent keeps up to date itself (update_plan) wins over an older Plan-mode answer.
  const agentPlan = latestAgentPlan(messages);
  const steps: { text: string; done: boolean; active?: boolean }[] =
    agentPlan && agentPlan.index >= planIdx ? agentPlan.steps : planIdx >= 0 ? parsePlan(messages[planIdx].content) : [];
  const canCompact =
    !streaming &&
    historyFor(messages).filter((m) => m.content.trim() || m.tools?.length).length >= 3;

  const folder = root ? (root.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? root) : "—";
  const parent = root ? root.replace(/[\\/]+$/, "").split(/[\\/]/).slice(0, -1).join("\\") : "";
  const modeLabel =
    mode === "plan"
      ? t("chat.modePlan")
      : mode === "agent"
        ? t("chat.modeAgent")
        : mode === "computer"
          ? isRuLike(lang)
            ? rt("Компьютер")
            : "Computer"
          : mode === "studio"
            ? isRuLike(lang)
              ? rt("Студия 3D")
              : "3D Studio"
            : t("chat.modeChat");

  return (
    <div className="flex h-full flex-col">
      <div className="aide-scroll min-h-0 flex-1 overflow-y-auto">
        <Section title={t("context.env")}>
          <div className="flex flex-col gap-0.5 py-0.5">
            <div className="flex items-center gap-2.5 py-1 text-[13px] text-ink-200">
              <Laptop size={15} className="shrink-0 text-ink-500" />
              <span className="min-w-0 truncate">{ru ? rt("Этот компьютер") : "This computer"}</span>
            </div>
            <div className="flex items-center gap-2.5 py-1 text-[13px] text-ink-200" title={root ?? undefined}>
              <FolderOpen size={15} className="shrink-0 text-ink-500" />
              <span className="min-w-0 truncate">
                {folder}
                {parent && <span className="text-ink-500"> · {parent}</span>}
              </span>
            </div>
            {branch && (
              <div className="flex items-center gap-2.5 py-1 text-[13px] text-ink-200">
                <GitBranch size={15} className="shrink-0 text-ink-500" />
                <span className="min-w-0 truncate font-mono text-[12.5px]">{branch}</span>
              </div>
            )}
          </div>
          <Row label={t("context.mode")} value={modeLabel} />
          <Row label={t("context.model")} value={model || "—"} mono />
          <Row
            label={t("context.activeFile")}
            value={active ? (attachFile ? `≈${stats.file}` : t("context.activeFileOff")) : "—"}
            hint={active?.path}
            mono={!!active && attachFile}
          />
        </Section>

        <Section title={t("context.title")}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[14px] font-medium text-ink-100">
              {pct}% {ru ? rt("занято") : "used"}
            </span>
            <span className="font-mono text-[12px] text-ink-400" title={`${used.toLocaleString()} / ${win.toLocaleString()}`}>
              {formatTokens(used)} / {formatTokens(win)}
            </span>
          </div>
          <div
            className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-white/[0.07]"
            role="img"
            aria-label={`${pct}% ${ru ? rt("занято") : "used"}`}
          >
            {segments.map((seg, i) => (
              <div key={seg.key} className={"h-full transition-[width] duration-500 " + SEGMENT_COLOR[seg.key]} style={{ width: `${widths[i]}%` }} />
            ))}
          </div>
          <ul className="mt-3 flex flex-col">
            {segments.map((seg) => (
              <li key={seg.key} className="flex items-center gap-2.5 py-[5px] text-[12.5px]">
                <span aria-hidden className={"size-2.5 shrink-0 rounded-[3px] " + SEGMENT_COLOR[seg.key]} />
                <span className="min-w-0 flex-1 truncate text-ink-300" title={seg.key === "messages" && stats.dropped > 0 ? t("context.compactedInfo", { n: String(stats.dropped) }) : undefined}>
                  {L(seg.key)}
                </span>
                <span className="font-mono text-[11.5px] text-ink-400">{formatTokens(seg.tokens)}</span>
                <span className="w-11 text-right font-mono text-[11.5px] text-ink-300">{formatShare(seg.tokens, win)}</span>
              </li>
            ))}
            <li className="flex items-center gap-2.5 py-[5px] text-[12.5px]">
              <span aria-hidden className="size-2.5 shrink-0 rounded-[3px] bg-white/[0.12]" />
              <span className="min-w-0 flex-1 truncate text-ink-400">{t("context.free")}</span>
              <span className="font-mono text-[11.5px] text-ink-500">{formatTokens(free)}</span>
              <span className="w-11 text-right font-mono text-[11.5px] text-ink-400">{formatShare(free, win)}</span>
            </li>
          </ul>

          <div className="mt-1 border-t border-line/40 pt-1">
            {extra && extra.mcpCount > 0 && (
              <Disclosure label={ru ? rt("Инструменты MCP") : "MCP tools"} count={extra.mcpCount}>
                <ul className="max-h-40 overflow-y-auto">
                  {extra.mcpNames.map((n) => (
                    <li key={n} className="truncate py-0.5 font-mono text-[11.5px] text-ink-500" title={n}>
                      {n}
                    </li>
                  ))}
                </ul>
              </Disclosure>
            )}
            {extra && extra.memoryFiles.length > 0 && (
              <Disclosure label={ru ? rt("Память и правила проекта") : "Memory and project rules"} count={extra.memoryFiles.length}>
                <ul>
                  {extra.memoryFiles.map((f) => (
                    <li key={f.name} className="flex justify-between gap-3 py-0.5 text-[12px] text-ink-500">
                      <span className="truncate font-mono">{f.name}</span>
                      <span className="font-mono">{formatTokens(f.tokens)}</span>
                    </li>
                  ))}
                </ul>
              </Disclosure>
            )}
            {extra && extra.skillsCount > 0 && (
              <div className="flex items-center gap-1.5 py-1 pl-[18px] text-[12.5px] text-ink-400">
                <span className="min-w-0 flex-1 truncate">{ru ? rt("Включённые навыки") : "Enabled skills"}</span>
                <span className="font-mono text-[11.5px] text-ink-500">{extra.skillsCount}</span>
              </div>
            )}
            {extra && extra.toolsCount > 0 && (
              <div className="flex items-center gap-1.5 py-1 pl-[18px] text-[12.5px] text-ink-400">
                <span className="min-w-0 flex-1 truncate">{ru ? rt("Инструментов AIDE") : "AIDE tools"}</span>
                <span className="font-mono text-[11.5px] text-ink-500">{extra.toolsCount}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 py-1 pl-[18px] text-[12.5px] text-ink-400">
              <span className="min-w-0 flex-1 truncate">{t("context.tools")}</span>
              <span className="font-mono text-[11.5px] text-ink-500">{stats.tools}</span>
            </div>
          </div>

          <p className="mt-2 text-[11.5px] text-ink-500">
            {ru ? rt("До заполнения окна") : "Until the window is full"}: {formatTokens(free)}
          </p>

          <div className="mt-2 border-t border-line/40 pt-1.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12.5px] text-ink-500">{t("context.window")}</span>
              <input
                type="number"
                min={4096}
                max={2000000}
                step={1000}
                value={win}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isFinite(v) || v < 4096) return;
                  setWin(v);
                  saveWindow(v);
                }}
                className="w-24 rounded-md border border-line/60 bg-white/[0.04] px-2 py-1 text-right font-mono text-[12px] text-ink-100 focus:border-teal-300/50 focus:outline-hidden"
              />
            </div>
            <p className="mt-1 text-[11px] leading-snug text-ink-600">{t("context.windowHint")}</p>
          </div>
        </Section>

        <Section
          title={t("context.plan")}
          right={
            steps.length > 0 ? (
              <span className="font-mono text-[11px] text-ink-600">
                {steps.filter((s) => s.done).length}/{steps.length}
              </span>
            ) : undefined
          }
        >
          {steps.length > 0 ? (
            <ol className="mt-0.5 flex flex-col gap-1.5">
              {steps.map((s, i) => (
                <li key={`${i}-${s.text}`} className="flex gap-2 text-[12.5px] leading-snug">
                  <span
                    className={
                      "mt-[1px] shrink-0 font-mono text-[11px] " + (s.done ? "text-teal-300" : "text-ink-600")
                    }
                  >
                    {s.done ? "✓" : s.active ? "▸" : String(i + 1).padStart(2, "0")}
                  </span>
                  <span className={s.done ? "text-ink-500 line-through" : "text-ink-300"}>{s.text}</span>
                </li>
              ))}
            </ol>
          ) : (
            <div className="mt-0.5">
              <p className="text-[12px] leading-snug text-ink-600">{t("context.planEmpty")}</p>
              <button
                type="button"
                onClick={() => setMode("plan")}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-line/60 px-2.5 py-1 text-[12px] text-ink-300 transition-colors hover:border-teal-300/40 hover:text-ink-50"
              >
                <ListChecks size={12} />
                {t("context.planMode")}
              </button>
            </div>
          )}
        </Section>
      </div>

      <div className="shrink-0 border-t border-line/60 px-3 py-2.5">
        {compacting && (
          <div className="mb-2 flex items-center gap-2 text-[12px] text-teal-200">
            <Archive size={12} className="animate-pulse" />
            {t("chat.compact")}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void compact()}
            disabled={!canCompact}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-line/60 px-2.5 py-1.5 text-[12.5px] text-ink-200 transition-colors hover:border-teal-300/40 hover:text-ink-50 disabled:opacity-40 disabled:hover:border-line/60"
          >
            <Archive size={13} />
            {t("context.compact")}
          </button>
          <button
            onClick={clear}
            disabled={streaming}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-line/60 px-2.5 py-1.5 text-[12.5px] text-ink-400 transition-colors hover:border-rose-400/40 hover:text-rose-200 disabled:opacity-40"
          >
            <Eraser size={13} />
            {t("context.clearChat")}
          </button>
        </div>
      </div>
    </div>
  );
}
