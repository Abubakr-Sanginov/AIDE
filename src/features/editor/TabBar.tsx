import { rt } from "@/i18n/tgMap";
import { isRuLike } from "@/i18n/ruLike";
import { useState } from "react";
import { ChevronDown, GitCompare, Play, X } from "lucide-react";
import { runFile, runnerFor } from "@/features/terminal/runFile";
import { useI18n } from "@/i18n";
import { useTabs } from "@/stores/tabs";
import { getFileIcon } from "@/lib/fileIcons";
import { useFeatureText } from "@/i18n/features";
import { useDiff } from "@/features/diff/store";
import { Indicator, useIndicator } from "@/ui/Indicator";

export function TabBar() {
  const ft = useFeatureText();
  const tabs = useTabs((s) => s.tabs);
  const activeId = useTabs((s) => s.activeId);
  const setActive = useTabs((s) => s.setActive);
  const close = useTabs((s) => s.close);
  const diffDoc = useDiff((s) => s.doc);
  const diffActive = useDiff((s) => s.active);
  const { lang } = useI18n();
  const [runError, setRunError] = useState("");
  const [runMenu, setRunMenu] = useState(false);
  const tabIndicator = useIndicator(`${diffActive ? "diff" : activeId}|${tabs.length}|${diffDoc ? 1 : 0}`);

  if (tabs.length === 0 && !diffDoc) return null;
  const activeTab = diffActive ? undefined : tabs.find((t) => t.id === activeId);
  const runner = activeTab ? runnerFor(activeTab.name) : null;

  // Clicking the already active tab does not change the store, so leave the diff explicitly.
  const select = (id: string) => {
    useDiff.getState().hide();
    setActive(id);
  };

  return (
    <div className="aide-panel-header flex h-10 shrink-0 select-none items-center border-b">
    <div ref={tabIndicator.ref} role="tablist" className="aide-scroll relative isolate flex h-full min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2">
      <Indicator box={tabIndicator.box} radius={8} />
      {tabs.map((tab) => {
        const isActive = tab.id === activeId && !diffActive;
        const fi = getFileIcon(tab.name);
        const Icon = fi.icon;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            tabIndex={0}
            onClick={() => select(tab.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                select(tab.id);
              }
            }}
            onAuxClick={(e) => {
              if (e.button === 1) close(tab.id);
            }}
            title={tab.path}
            className={
              "aide-pop group relative flex h-7 min-w-24 max-w-48 cursor-pointer items-center gap-2 rounded-lg px-2.5 text-[12.5px] transition-colors duration-150 " +
              (isActive
                ? "text-ink-50"
                : "text-ink-500 hover:bg-white/[0.04] hover:text-ink-200")
            }
          >
            <Icon size={14} className={`shrink-0 ${fi.color}`} />
            <span className="truncate">{tab.name}</span>
            {tab.dirty && (
              <span className="aide-pop size-1.5 shrink-0 rounded-full bg-brand-300" aria-label="unsaved" />
            )}
            <button
              aria-label="Close tab"
              onClick={(e) => {
                e.stopPropagation();
                close(tab.id);
              }}
              className={
                "ml-auto shrink-0 rounded-md p-0.5 text-ink-500 hover:bg-white/[0.1] hover:text-ink-50 " +
                (isActive ? "opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100")
              }
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
      {diffDoc && (
        <div
          role="tab"
          aria-selected={diffActive}
          tabIndex={0}
          onClick={() => useDiff.getState().activate()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              useDiff.getState().activate();
            }
          }}
          onAuxClick={(e) => {
            if (e.button === 1) useDiff.getState().close();
          }}
          title={`${diffDoc.path} (${diffDoc.leftLabel} ↔ ${diffDoc.rightLabel})`}
          className={
            "group relative flex h-7 min-w-24 max-w-56 cursor-pointer items-center gap-2 rounded-lg px-2.5 text-[12.5px] transition-colors duration-150 " +
            (diffActive ? "text-ink-50" : "text-ink-500 hover:bg-white/[0.04] hover:text-ink-200")
          }
        >
          <GitCompare size={14} className="shrink-0 text-sky-300" />
          <span className="truncate">{diffDoc.title}</span>
          <span className="shrink-0 text-[10.5px] text-ink-600">diff</span>
          <button
            aria-label={ft.diffClose}
            onClick={(e) => {
              e.stopPropagation();
              useDiff.getState().close();
            }}
            className={
              "ml-auto shrink-0 rounded-md p-0.5 text-ink-500 hover:bg-white/[0.1] hover:text-ink-50 " +
              (diffActive ? "opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100")
            }
          >
            <X size={13} />
          </button>
        </div>
      )}
    </div>
    {runner && activeTab && (
      <div className="flex shrink-0 items-center gap-1 px-2">
        {runError && (
          <span title={runError} className="max-w-[220px] truncate text-[12px] text-red-400">
            {runError}
          </span>
        )}
        <div className="relative flex items-center">
          <button
            title={(isRuLike(lang) ? rt(runner.label.ru) : runner.label.en)}
            aria-label={(isRuLike(lang) ? rt(runner.label.ru) : runner.label.en)}
            onClick={() => void runFile(activeTab.id).then((e) => setRunError(e ?? ""))}
            className="flex h-7 w-7 items-center justify-center rounded-l-lg text-ink-200 transition-colors hover:bg-white/[0.08] hover:text-ink-50"
          >
            <Play size={15} />
          </button>
          <button
            aria-label="Run options"
            aria-expanded={runMenu}
            onClick={() => setRunMenu((v) => !v)}
            className="flex h-7 w-5 items-center justify-center rounded-r-lg text-ink-400 transition-colors hover:bg-white/[0.08] hover:text-ink-50"
          >
            <ChevronDown size={12} />
          </button>
          {runMenu && (
            <>
              <div className="fixed inset-0 z-30" onMouseDown={() => setRunMenu(false)} />
              <div role="menu" className="aide-drop absolute right-0 top-full z-40 mt-1 min-w-[230px] rounded-xl border border-line/60 bg-ink-900 p-1 shadow-xl">
                {[
                  { label: (isRuLike(lang) ? rt(runner.label.ru) : runner.label.en), dedicated: false },
                  { label: isRuLike(lang) ? rt("Запустить в отдельном терминале") : "Run in Dedicated Terminal", dedicated: true },
                ].map((item) => (
                  <button
                    key={item.label}
                    role="menuitem"
                    onClick={() => {
                      setRunMenu(false);
                      void runFile(activeTab.id, item.dedicated).then((e) => setRunError(e ?? ""));
                    }}
                    className="flex h-8 w-full items-center rounded-lg px-3 text-left text-[13px] text-ink-200 hover:bg-white/[0.07]"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    )}
    </div>
  );
}
