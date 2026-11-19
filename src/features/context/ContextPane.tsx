import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Archive, ChevronDown, Eraser, ListChecks } from "lucide-react";
import { rt } from "@/i18n/tgMap";
import { isRuLike } from "@/i18n/ruLike";
import { useI18n } from "@/i18n";
import { historyFor, useAi, type ChatMessage } from "@/stores/ai";
import { useTabs } from "@/stores/tabs";
import { useWorkspace } from "@/stores/workspace";
import { t } from "@/i18n/t";
import { estimateTokens, loadWindow, saveWindow, windowFromModel } from "@/lib/contextSize";
import { parsePlan } from "@/lib/plan";

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
    return { inContext: inContext.length, dropped, tools, attach, file, total: text + attach + file };
  }, [messages, attachments, attachFile, active]);

  const winSize = win > 0 ? win : 1;
  const pct = Math.min(100, Math.round((stats.total / winSize) * 100));
  const planMsg = [...messages].reverse().find((m) => m.plan && m.content.trim());
  const steps = planMsg ? parsePlan(planMsg.content) : [];
  const canCompact =
    !streaming &&
    historyFor(messages).filter((m) => m.content.trim() || m.tools?.length).length >= 3;

  const folder = root ? (root.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? root) : "—";
  const modeLabel =
    mode === "plan"
      ? t("chat.modePlan")
      : mode === "agent"
        ? t("chat.modeAgent")
        : mode === "computer"
          ? isRuLike(lang)
            ? rt("Компьютер")
            : "Computer"
          : t("chat.modeChat");

  return (
    <div className="flex h-full flex-col">
      <div className="aide-scroll min-h-0 flex-1 overflow-y-auto">
        <Section title={t("context.env")}>
          <Row label={t("context.project")} value={folder} hint={root ?? undefined} />
          <Row label={t("context.mode")} value={modeLabel} />
          <Row label={t("context.model")} value={model || "—"} mono />
          <Row
            label={t("context.activeFile")}
            value={active ? (attachFile ? `≈${stats.file}` : t("context.activeFileOff")) : "—"}
            hint={active?.path}
            mono={!!active && attachFile}
          />
        </Section>

        <Section
          title={t("context.title")}
          right={
            <span className="font-mono text-[11.5px] text-ink-300">
              {stats.total.toLocaleString()} / {win.toLocaleString()}
            </span>
          }
        >
          <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
            <div
              className={
                "h-full rounded-full transition-[width] duration-500 " + (pct > 85 ? "bg-rose-400" : "bg-teal-300")
              }
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between font-mono text-[11px] text-ink-600">
            <span>{pct}%</span>
            <span>
              {(win - Math.min(stats.total, win)).toLocaleString()} {t("context.free")}
            </span>
          </div>
          <Row
            label={t("context.messages")}
            value={`${stats.inContext} / ${messages.length}`}
            hint={stats.dropped > 0 ? t("context.compactedInfo", { n: String(stats.dropped) }) : undefined}
          />
          <Row label={t("context.tools")} value={String(stats.tools)} />
          <Row
            label={t("context.files")}
            value={attachments.length > 0 ? `${attachments.length} · ≈${stats.attach.toLocaleString()}` : "—"}
          />
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
                    {s.done ? "✓" : String(i + 1).padStart(2, "0")}
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
