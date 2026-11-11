import { Globe, X } from "lucide-react";
import { useI18n } from "@/i18n";
import { rt } from "@/i18n/tgMap";
import { isRuLike } from "@/i18n/ruLike";
import { useUi } from "@/stores/ui";
import { BrowserPane } from "@/features/browser/BrowserPane";

/**
 * The built-in browser as a side panel for Vibe and Design (IDE has it as a tab of the right panel).
 * It opens next to what the user is doing, so the window never has to jump to another mode.
 */
export function BrowserDock() {
  const { lang } = useI18n();
  const ru = isRuLike(lang);
  const title = ru ? rt("Браузер") : "Browser";
  return (
    <aside className="aide-island aide-panel-in-right mx-1.5 mb-0 flex min-h-0 w-[min(460px,42vw)] shrink-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 px-3">
        <Globe size={15} className="text-ink-400" />
        <span className="text-[14px] font-medium text-ink-100">{title}</span>
        <button
          aria-label={ru ? rt("Закрыть") : "Close"}
          title={ru ? rt("Закрыть") : "Close"}
          onClick={() => useUi.getState().setBrowserDock(false)}
          className="aide-icon-button ml-auto size-8"
        >
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <BrowserPane />
      </div>
    </aside>
  );
}
