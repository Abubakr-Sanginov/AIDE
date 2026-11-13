import { rt } from "@/i18n/tgMap";
import { isRuLike } from "@/i18n/ruLike";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useUi } from "@/stores/ui";
import { useI18n } from "@/i18n";
import { ChatPanel } from "@/features/chat/ChatPanel";
import { BrowserPane } from "@/features/browser/BrowserPane";
import { KinsPane } from "@/features/kins/KinsView";
import { useExtHost, type WebviewInfo } from "@/features/exthost/store";
import { attachFrame, WEBVIEW_ORIGIN } from "@/features/exthost/webviews";
import { Indicator, useIndicator } from "@/ui/Indicator";

/** One extension webview: an iframe from the aideext: scheme, isolated from the app. */
function WebviewFrame({ info, active }: { info: WebviewInfo; active: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => () => attachFrame(info.id, null), [info.id]);
  if (info.ver === 0) return <div className={active ? "p-4 text-[13px] text-ink-500" : "hidden"}>…</div>;
  return (
    <iframe
      ref={ref}
      title={info.title || info.viewType}
      // Own origin (not the app's): scripts run, but cannot reach AIDE's data or navigate the top window.
      sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
      src={`${WEBVIEW_ORIGIN}/__webview/${encodeURIComponent(info.id)}?v=${info.ver}`}
      onLoad={() => attachFrame(info.id, ref.current?.contentWindow ?? null)}
      className={active ? "h-full w-full border-0" : "hidden"}
    />
  );
}

export function RightPanel() {
  const { lang } = useI18n();
  const rightPanelWidth = useUi((s) => s.rightPanelWidth);
  const tab = useUi((s) => s.rightTab);
  const setTab = useUi((s) => s.setRightTab);
  const webviews = useExtHost((s) => s.webviews);
  const viewDefs = useExtHost((s) => s.viewDefs);
  const viewProviders = useExtHost((s) => s.viewProviders);
  const viewWebview = useExtHost((s) => s.viewWebview);
  const indicator = useIndicator(tab);

  // Tell the extensions which webview is visible.
  useEffect(() => {
    const host = useExtHost.getState();
    for (const id of Object.keys(webviews)) host.notify("webview.visible", { id, visible: id === tab });
  }, [tab, webviews]);

  const tabs: { key: string; label: string; onClick: () => void; close?: () => void }[] = [
    { key: "chat", label: isRuLike(lang) ? rt("Агент") : "Agent", onClick: () => setTab("chat") },
    { key: "computer", label: isRuLike(lang) ? rt("Компьютер") : "Computer", onClick: () => setTab("computer") },
    { key: "kins", label: isRuLike(lang) ? rt("Экипаж") : "Crew", onClick: () => setTab("kins") },
    { key: "browser", label: isRuLike(lang) ? rt("Браузер") : "Browser", onClick: () => setTab("browser") },
  ];
  for (const def of viewDefs) {
    if (!viewProviders[def.viewId]) continue;
    const id = viewWebview[def.viewId];
    tabs.push({ key: id ?? `view:${def.viewId}`, label: def.name, onClick: () => (id ? setTab(id) : void useExtHost.getState().openView(def.viewId).catch(() => {})) });
  }
  for (const w of Object.values(webviews)) {
    if (w.kind === "panel") tabs.push({ key: w.id, label: w.title || w.viewType, onClick: () => setTab(w.id), close: () => useExtHost.getState().notify("webview.closed", { id: w.id }) });
  }

  return (
    <aside style={{ width: rightPanelWidth }} className="aide-flat aide-vt-right flex shrink-0 select-none flex-col">
      <div ref={indicator.ref} role="tablist" className="aide-scroll relative isolate flex h-9 shrink-0 items-end gap-4 overflow-x-auto border-b border-line/60 px-3">
        <Indicator box={indicator.box} variant="underline" />
        {tabs.map((t) => (
          <span key={t.key} className="-mb-px flex shrink-0 items-center gap-1">
            <button
              role="tab"
              aria-selected={tab === t.key}
              onClick={t.onClick}
              className="border-b-2 border-transparent pb-1.5 text-[13px] font-medium text-ink-400 transition-colors hover:text-ink-50 aria-selected:text-ink-50"
            >
              {t.label}
            </button>
            {t.close && (
              <button
                aria-label="Close"
                onClick={() => {
                  t.close?.();
                  useExtHost.getState().closeWebview(t.key);
                }}
                className="mb-1 text-ink-500 hover:text-ink-100"
              >
                <X size={12} />
              </button>
            )}
          </span>
        ))}
      </div>
      <div className="aide-vt-right-body min-h-0 flex-1">
        {tab === "chat" && <div className="h-full"><ChatPanel /></div>}
        {tab === "computer" && <div className="h-full"><ChatPanel computerTab /></div>}
        {tab === "kins" && <div className="h-full"><KinsPane /></div>}
        {tab === "browser" && <div className="h-full"><BrowserPane /></div>}
        {Object.values(webviews).map((w) => (
          <WebviewFrame key={w.id} info={w} active={tab === w.id} />
        ))}
      </div>
    </aside>
  );
}
