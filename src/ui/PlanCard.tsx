import { ListChecks } from "lucide-react";
import { rt } from "@/i18n/tgMap";
import { isRuLike } from "@/i18n/ruLike";
import { useI18n } from "@/i18n";
import type { AgentPlanStep } from "@/lib/plan";

/** The plan the agent wrote for a complex task, with finished steps ticked off as it works. */
export function PlanCard({ steps }: { steps: AgentPlanStep[] }) {
  const { lang } = useI18n();
  const done = steps.filter((s) => s.done).length;
  return (
    <section aria-label={isRuLike(lang) ? rt("План") : "Plan"} className="my-2 rounded-xl border border-line bg-white/[0.02] px-3 py-2">
      <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-ink-300">
        <ListChecks size={13} className="text-teal-300" />
        {isRuLike(lang) ? rt("План") : "Plan"}
        <span className="ml-auto font-mono text-[11px] text-ink-500">
          {done}/{steps.length}
        </span>
      </div>
      <ol className="flex flex-col gap-1">
        {steps.map((s, i) => (
          <li key={`${i}-${s.text}`} aria-current={s.active ? "step" : undefined} className="flex gap-2 text-[13px] leading-snug">
            <span className={"mt-[1px] w-4 shrink-0 text-center font-mono text-[11px] " + (s.done ? "text-teal-300" : s.active ? "text-amber-300" : "text-ink-600")}>
              {s.done ? "✓" : s.active ? "▸" : String(i + 1)}
            </span>
            <span className={s.done ? "text-ink-500 line-through" : s.active ? "text-ink-50" : "text-ink-300"}>{s.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
