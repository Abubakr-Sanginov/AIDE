import { FolderTree, GitBranch, Scissors, Search, type LucideIcon } from "lucide-react";
import { useI18n } from "@/i18n";
import { useFeatureText } from "@/i18n/features";
import { useUi, type SidebarPanel } from "@/stores/ui";
import { ExplorerPanel } from "@/features/explorer/ExplorerPanel";
import { SearchPanel } from "@/features/search/SearchPanel";
import { GitPanel } from "@/features/git/GitPanel";
import { SnippetsPanel } from "@/features/snippets/SnippetsPanel";
import { useGit } from "@/features/git/store";
import { Indicator, useIndicator } from "@/ui/Indicator";

// Flat side panel: a row of icon tabs switches the view (no activity rail).
export function Sidebar() {
  const { t } = useI18n();
  const ft = useFeatureText();
  const activePanel = useUi((s) => s.activePanel);
  const setPanel = useUi((s) => s.setPanel);
  const sidebarWidth = useUi((s) => s.sidebarWidth);
  const changes = useGit((s) => s.status?.files.length ?? 0);
  const indicator = useIndicator(activePanel);

  const tabs: { id: SidebarPanel; icon: LucideIcon; title: string; badge?: number }[] = [
    { id: "explorer", icon: FolderTree, title: t("activityBar.explorer") },
    { id: "search", icon: Search, title: t("activityBar.search") },
    { id: "git", icon: GitBranch, title: ft.scmShortcut, badge: changes },
    { id: "snippets", icon: Scissors, title: ft.snippetsTitle },
  ];

  return (
    <aside style={{ width: sidebarWidth }} className="aide-flat aide-vt-sidebar flex shrink-0 select-none flex-col">
      <div ref={indicator.ref} role="tablist" className="relative isolate flex h-11 shrink-0 items-center gap-1 px-2">
        <Indicator box={indicator.box} radius={8} />
        {tabs.map(({ id, icon: Icon, title, badge }) => (
          <button
            key={id}
            role="tab"
            aria-selected={activePanel === id}
            title={title}
            aria-label={badge ? `${title} (${badge})` : title}
            onClick={() => setPanel(id)}
            className={
              "relative flex size-9 items-center justify-center rounded-lg transition-colors duration-150 " +
              (activePanel === id
                ? "text-ink-50"
                : "text-ink-500 hover:bg-white/[0.05] hover:text-ink-100")
            }
          >
            <Icon size={17} strokeWidth={1.7} className={"transition-transform duration-300 " + (activePanel === id ? "scale-110" : "")} />
            {!!badge && (
              <span
                key={badge}
                aria-hidden
                className="aide-bump absolute right-0.5 top-0.5 min-w-4 rounded-full bg-brand-300 px-1 text-center text-[9px] font-semibold leading-4 text-ink-950"
              >
                {badge > 99 ? "99+" : badge}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="aide-vt-sidebar-body min-h-0 flex-1">
        {activePanel === "explorer" && <ExplorerPanel />}
        {activePanel === "search" && <SearchPanel />}
        {activePanel === "git" && <GitPanel />}
        {activePanel === "snippets" && <SnippetsPanel />}
      </div>
    </aside>
  );
}
