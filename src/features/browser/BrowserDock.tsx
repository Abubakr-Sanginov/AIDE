import { X } from "lucide-react";
import { useI18n } from "@/i18n";
import { rt } from "@/i18n/tgMap";
import { isRuLike } from "@/i18n/ruLike";
import { useUi, type SideDockTab } from "@/stores/ui";
import { BrowserPane } from "@/features/browser/BrowserPane";
import { ContextPane } from "@/features/context/ContextPane";
import { Indicator, useIndicator } from "@/ui/Indicator";

/**
 * The right side of Vibe and Design: the context panel (environment, window fill, plan,
 * compaction history) and the built-in browser as two tabs, so the page the agent looks at
 * and the plan it follows stay in one place. IDE has the same pair as tabs of the right panel.
 */
export function BrowserDock() {
  const { lang } = useI18n();
  const ru = isRuLike(lang);
  const tab = useUi((s) => s.sideDockTab);
  const setTab = useUi((s) => s.setSideDockTab);
  const indicator = useIndicator(tab);

  const tabs: { key: SideDockTab; label: string }[] = [
    { key: "context", label: ru ? rt("Контекст") : "Context" },
    { key: "browser", label: ru ? rt("Браузер") : "Browser" },
  ];

  return (
    <aside className="aide-island aide-panel-in-right mx-1.5 mb-0 flex min-h-0 w-[min(460px,42vw)] shrink-0 flex-col">
      <div className="flex shrink-0 items-center border-b border-line/60 pr-1">
        <div
          ref={indicator.ref}
          role="tablist"
          aria-label={ru ? rt("Правая панель") : "Side panel"}
          className="aide-scroll relative isolate flex h-9 min-w-0 flex-1 items-end gap-1 overflow-x-auto px-2"
        >
          <Indicator box={indicator.box} variant="underline" />
          {tabs.map((t) => (
            // Both tabs always fit: they share the strip and long labels shorten instead of clipping.
            <span key={t.key} className="-mb-px flex min-w-[3.25rem] flex-[1_1_auto] items-center justify-center">
              <button
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                title={t.label}
                onClick={() => setTab(t.key)}
                className="w-full truncate border-b-2 border-transparent pb-1.5 text-[12.5px] font-medium text-ink-400 transition-colors hover:text-ink-50 aria-selected:text-ink-50"
              >
                {t.label}
              </button>
            </span>
          ))}
        </div>
        <button
          aria-label={ru ? rt("Закрыть") : "Close"}
          title={ru ? rt("Закрыть") : "Close"}
          onClick={() => useUi.getState().setBrowserDock(false)}
          className="aide-icon-button size-8"
        >
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {/* Unmounting the page (not hiding it) is what closes its native webview. */}
        {tab === "context" ? <ContextPane /> : <BrowserPane />}
      </div>
    </aside>
  );
}
