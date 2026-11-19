import { useEffect, useMemo, useState } from "react";
import { Archive, Eraser, Layers, ListChecks } from "lucide-react";
import { historyFor, useAi, type ChatMessage } from "@/stores/ai";
import { useTabs } from "@/stores/tabs";
import { t } from "@/i18n/t";
import { estimateTokens, loadWindow, saveWindow, windowFromModel } from "@/lib/contextSize";
import { parsePlan } from "@/lib/plan";

/** A picture is not text: one screen-sized image costs about this much of a context window. */
const IMAGE_TOKENS = 1_500;
/** Per-message framing (role, separators) on top of the text itself. */
const MESSAGE_OVERHEAD = 6;

const num = new Intl.NumberFormat("ru-RU");

function tokensOfMessage(m: ChatMessage): number {
  let n = estimateTokens(m.content) + MESSAGE_OVERHEAD;
  for (const tool of m.tools ?? []) {
    n += estimateTokens(tool.args) + estimateTokens(tool.result) + 8;
  }
  return n;
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="min-w-0 text-[12.5px] text-ink-500">{label}</span>
      <span className="shrink-0 text-right text-[12.5px] text-ink-200" title={hint}>
        {value}
      </span>
    </div>
  );
}

/**
 * The Context tab: what the next request will carry, how much of the model's window it takes,
 * the plan the agent wrote, and the two ways to free space — compact the history or clear the chat.
 */
export function ContextPane() {
  const messages = useAi((s) => s.messages);
  const attachments = useAi((s) => s.attachments);
  const attachFile = useAi((s) => s.attachFile);
  const model = useAi((s) => s.model);
  const mode = useAi((s) => s.mode);
  const streaming = useAi((s) => s.streaming);
  const compacting = useAi((s) => s.compacting);
  const compact = useAi((s) => s.compact);
  const clear = useAi((s) => s.clear);

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

  const pct = win > 0 ? Math.min(100, Math.round((stats.total / win) * 100)) : 0;
  const planMsg = [...messages].reverse().find((m) => m.plan && m.content.trim());
  const steps = planMsg ? parsePlan(planMsg.content) : [];
  const canCompact =
    !streaming &&
    historyFor(messages).filter((m) => m.content.trim() || m.tools?.length).length >= 3;

  return (
    <div className="flex h-full flex-col">
      <div className="aide-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="flex items-center gap-2">
          <Layers size={14} className="text-ink-400" />
          <span className="text-[13px] font-medium text-ink-100">{t("context.title")}</span>
          <span className="ml-auto rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-ink-400">
            {mode}
          </span>
        </div>

        <div className="mt-4">
          <div className="flex items-baseline justify-between">
            <span className="text-[12px] text-ink-500">{t("context.total")}</span>
            <span className="font-mono text-[12.5px] text-ink-100">
              {num.format(stats.total)} / {num.format(win)}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
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
              {num.format(Math.max(0, win - stats.total))} {t("context.free")}
            </span>
          </div>
        </div>

        <label className="mt-3 flex items-center justify-between gap-3">
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
        </label>
        <p className="mt-1 text-[11px] leading-snug text-ink-600">{t("context.windowHint")}</p>

        <div className="mt-3 border-t border-line/50 pt-1">
          <Row
            label={t("context.messages")}
            value={`${num.format(stats.inContext)} / ${num.format(messages.length)}`}
            hint={stats.dropped > 0 ? t("context.compactedInfo", { n: String(stats.dropped) }) : undefined}
          />
          <Row label={t("context.tools")} value={num.format(stats.tools)} />
          <Row
            label={t("context.files")}
            value={attachments.length > 0 ? `${attachments.length} · ≈${num.format(stats.attach)}` : "—"}
          />
          <Row
            label={t("context.activeFile")}
            value={
              active && attachFile ? `≈${num.format(stats.file)}` : active ? t("context.activeFileOff") : "—"
            }
            hint={active?.path}
          />
          {active && attachFile && (
            <div className="truncate pb-1 font-mono text-[11px] text-ink-600" title={active.path}>
              {active.path}
            </div>
          )}
        </div>

        <div className="mt-4 border-t border-line/50 pt-3">
          <div className="flex items-center gap-2">
            <ListChecks size={13} className="text-ink-400" />
            <span className="text-[12.5px] font-medium text-ink-200">{t("context.plan")}</span>
          </div>
          {steps.length > 0 ? (
            <ol className="mt-2 flex flex-col gap-1.5">
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
            <p className="mt-1.5 text-[12px] leading-snug text-ink-600">{t("context.planEmpty")}</p>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-line/60 px-4 py-3">
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
        <p className="mt-1.5 text-[11px] leading-snug text-ink-600">{t("context.compactHint")}</p>
      </div>
    </div>
  );
}
