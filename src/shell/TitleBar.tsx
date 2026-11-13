import { rt } from "@/i18n/tgMap";
import { isRuLike } from "@/i18n/ruLike";
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Code2,
  Copy,
  Globe,
  MessageSquare,
  Palette,
  PanelRight,
  Minus,
  Search,
  Settings,
  Sparkles,
  Square,
  SquareTerminal,
  X,
} from "lucide-react";
import { useI18n } from "@/i18n";
import { useUi } from "@/stores/ui";
import { CreateInProjectButton, DesignToolbar } from "@/features/design/DesignToolbar";
import { useDesignText } from "@/features/design/strings";
import { useWorkspace } from "@/stores/workspace";
import { useCommands } from "@/stores/commands";
import { useTerminal } from "@/stores/terminal";
import { basename } from "@/lib/fsUtils";
import { Select } from "@/ui/Select";
import { useChats } from "@/stores/chats";
import { useVibeText } from "@/features/vibe/strings";
import { useTasks } from "@/features/vibe/tasks";
import { useKins } from "@/features/kins/store";
import { useKinsText } from "@/features/kins/strings";
import { Indicator, useIndicator } from "@/ui/Indicator";

function appWindow() {
  try {
    return getCurrentWindow();
  } catch {
    return null; // plain browser preview, not inside Tauri
  }
}

// Custom window chrome: drag region + command-palette trigger + layout toggles
// + window controls. The native frame is disabled in tauri.conf.json.
export function TitleBar() {
  const { t, lang } = useI18n();
  const root = useWorkspace((s) => s.root);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const rightPanelVisible = useUi((s) => s.rightPanelVisible);
  const toggleRightPanel = useUi((s) => s.toggleRightPanel);
  const terminalVisible = useUi((s) => s.terminalVisible);
  const toggleTerminal = useUi((s) => s.toggleTerminal);
  const setPanel = useUi((s) => s.setPanel);
  const mode = useUi((s) => s.mode);
  const browserDock = useUi((s) => s.browserDock);
  const setMode = useUi((s) => s.setMode);
  const D = useDesignText();
  const openPalette = useCommands((s) => s.openWithT);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = appWindow();
    if (!win) return;
    let off: (() => void) | undefined;
    let disposed = false;
    const sync = () => void win.isMaximized().then(setMaximized).catch(() => {});
    sync();
    void win
      .onResized(sync)
      .then((fn) => {
        if (disposed) fn();
        else off = fn;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      off?.();
    };
  }, []);

  const ctl =
    "flex h-full w-11 items-center justify-center text-ink-400 transition-colors hover:bg-white/[0.07] hover:text-ink-50";

  const designMode = mode === "design";
  const vibeMode = mode === "vibe";
  const V = useVibeText();
  const { tasks, activeId } = useTasks();
  const K = useKinsText();
  const tabNow = useKins((s) => s.tab);
  const kinsTab = tabNow === "kins";
  const kinsView = useKins((s) => s.view);
  const sideOpen = useKins((s) => s.sideOpen);
  const modeIndicator = useIndicator(mode);
  const vibeIndicator = useIndicator(vibeMode ? tabNow : null);

  return (
    <header
      data-tauri-drag-region
      onDoubleClick={() => void appWindow()?.toggleMaximize()}
      className={
        "h-[var(--aide-titlebar)] shrink-0 select-none items-center gap-2 pl-4 " +
        (designMode ? "flex" : "grid grid-cols-[1fr_minmax(0,520px)_1fr]")
      }
    >
      <div data-tauri-drag-region className="flex min-w-0 items-center gap-3">
        <div className="flex items-center gap-2">
          <img src="/logo.svg" alt="" draggable={false} className="size-6 rounded-[7px]" />
          <span className="text-[15px] font-semibold tracking-tight text-ink-50">AIDE</span>
        </div>
        <div ref={modeIndicator.ref} className="relative isolate flex items-center rounded-xl bg-white/[0.05] p-0.5" onDoubleClick={(e) => e.stopPropagation()}>
          <Indicator box={modeIndicator.box} radius={9} />
          {[
            { id: "vibe", Icon: Sparkles, label: V.vibe, on: vibeMode, run: () => setMode("vibe") },
            { id: "ide", Icon: Code2, label: "IDE", on: mode === "ide", run: () => (mode !== "ide" ? setMode("ide") : toggleSidebar()) },
            { id: "design", Icon: Palette, label: D.design, on: designMode, run: () => setMode("design") },
          ].map(({ id, Icon, label, on, run }) => (
            <button
              key={id}
              aria-pressed={on}
              title={label}
              aria-label={label}
              onClick={run}
              className="flex h-7 items-center gap-1.5 rounded-[14px] px-2 text-[13.5px] font-medium text-ink-400 transition-colors hover:text-ink-50 aria-pressed:text-ink-50"
            >
              <Icon size={14} className={"transition-transform duration-300 " + (on ? "scale-110" : "")} />
              {on && <span key={id} className="aide-slide-in">{label}</span>}
            </button>
          ))}
        </div>
      </div>

      {designMode ? (
        <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center justify-center">
          <DesignToolbar />
        </div>
      ) : vibeMode && kinsTab ? (
        <div data-tauri-drag-region className="flex min-w-0 items-center justify-center gap-2 text-[14px]">
          <span className="font-semibold text-ink-50">{root ? basename(root) : V.noProject}</span>
          <span className="text-ink-600">|</span>
          <span className="truncate text-ink-400">{kinsView === "call" ? K.call : K.kins}</span>
        </div>
      ) : vibeMode ? (
        <div data-tauri-drag-region className="flex min-w-0 items-center justify-center" onDoubleClick={(e) => e.stopPropagation()}>
          <Select
            title={V.newTask}
            value={activeId ?? ""}
            options={tasks.map((task) => ({ value: task.id, label: task.title || V.untitled }))}
            onChange={(id) => useChats.getState().openChat(id)}
            className="max-w-[420px] text-[14px] font-medium text-ink-100"
            menuMinWidth={280}
          />
        </div>
      ) : (
        <button
          onClick={() => openPalette(t as (key: string) => string)}
          onDoubleClick={(e) => e.stopPropagation()}
          className="flex h-8 w-full items-center gap-2 rounded-lg border border-line bg-white/[0.035] px-3 text-[14px] text-ink-200 transition-colors hover:border-line-strong hover:bg-white/[0.06]"
        >
          <span className="min-w-0 flex-1 truncate text-center">
            <Search size={13} className="mr-2 inline -translate-y-px text-ink-400" />
            {root ? basename(root) : t("statusBar.noFolder")}
          </span>
          <span className="aide-kbd">Ctrl</span>
          <span className="aide-kbd -ml-1">P</span>
        </button>
      )}

      <div data-tauri-drag-region className="flex items-center justify-end">
        {vibeMode && (
          <div ref={vibeIndicator.ref} className="relative isolate mr-3 flex h-full items-stretch gap-4" onDoubleClick={(e) => e.stopPropagation()}>
            <Indicator box={vibeIndicator.box} variant="underline" />
            {(["agent", "computer", "kins"] as const).map((id) => (
              <button
                key={id}
                aria-pressed={tabNow === id}
                onClick={() => useKins.getState().setTab(id)}
                className="border-b-2 border-transparent px-0.5 text-[13px] font-medium text-ink-400 transition-colors hover:text-ink-50 aria-pressed:text-ink-50"
              >
                {id === "agent" ? V.agent : id === "computer" ? (isRuLike(lang) ? rt("Компьютер") : "Computer") : K.kins}
              </button>
            ))}
          </div>
        )}
        {vibeMode && kinsTab && (
          <button
            className="aide-icon-button mr-1 size-8"
            aria-pressed={sideOpen}
            title={K.togglePanel}
            aria-label={K.togglePanel}
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={() => useKins.getState().setSide(!sideOpen)}
          >
            <PanelRight size={16} />
          </button>
        )}
        {(vibeMode || designMode) && (
          <button
            className="aide-icon-button mr-1 size-8"
            aria-pressed={browserDock}
            title={isRuLike(lang) ? rt("Браузер") : "Browser"}
            aria-label={isRuLike(lang) ? rt("Браузер") : "Browser"}
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={() => useUi.getState().setBrowserDock(!browserDock)}
          >
            <Globe size={16} />
          </button>
        )}
        {designMode && <CreateInProjectButton />}
        {!designMode && !vibeMode && (
          <div className="mr-2 flex items-center gap-2" onDoubleClick={(e) => e.stopPropagation()}>
            <button
              className="aide-icon-button size-8"
              aria-pressed={terminalVisible}
              title={t("terminal.toggleShortcut")}
              aria-label={t("terminal.toggleShortcut")}
              onClick={() => {
                toggleTerminal();
                if (!terminalVisible) void useTerminal.getState().ensure();
              }}
            >
              <SquareTerminal size={15} />
            </button>
            <button className="aide-icon-button size-8" aria-pressed={rightPanelVisible} title={t("activityBar.chat")} aria-label={t("activityBar.chat")} onClick={toggleRightPanel}>
              <MessageSquare size={15} />
            </button>
          </div>
        )}
        <button
          className="aide-icon-button mr-3 size-8"
          title={t("activityBar.settings")}
          aria-label={t("activityBar.settings")}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={() => {
            setMode("ide");
            setPanel("settings");
          }}
        >
          <Settings size={16} />
        </button>
        <div className="flex h-full items-stretch">
          <button className={ctl} aria-label="Minimize" onClick={() => void appWindow()?.minimize()}>
            <Minus size={15} />
          </button>
          <button
            className={ctl}
            aria-label={maximized ? "Restore" : "Maximize"}
            onClick={() => void appWindow()?.toggleMaximize()}
          >
            {maximized ? <Copy size={12} /> : <Square size={12} />}
          </button>
          <button
            className={ctl + " hover:!bg-red-500 hover:!text-white"}
            aria-label="Close"
            onClick={() => void appWindow()?.close()}
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </header>
  );
}
