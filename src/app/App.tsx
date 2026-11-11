import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { fs } from "@/api/fs";
import { I18nProvider, useI18n } from "@/i18n";
import { TitleBar } from "@/shell/TitleBar";
import { ResizeHandle } from "@/shell/ResizeHandle";
import { Sidebar } from "@/shell/Sidebar";
import { EditorArea } from "@/features/editor/EditorArea";
import { SettingsPage } from "@/features/settings/SettingsPanel";
import { useBrowserIntent } from "@/features/browser/BrowserPane";
import { BrowserDock } from "@/features/browser/BrowserDock";
import { RightPanel } from "@/shell/RightPanel";
import { DesignView } from "@/features/design/DesignView";
import { VibeView } from "@/features/vibe/VibeView";
import { StatusBar } from "@/shell/StatusBar";
import { CommandPalette } from "@/features/palette/CommandPalette";
import { RecentProjects } from "@/features/recent/RecentProjects";
import { shortcutKey } from "@/lib/keys";
import { useUi } from "@/stores/ui";
import { useTabs } from "@/stores/tabs";
import { useTree } from "@/stores/tree";
import { useWorkspace } from "@/stores/workspace";
import { useCommands } from "@/stores/commands";
import { useAi, ensureAiEvents } from "@/stores/ai";
import { useExtensions } from "@/features/extensions/store";
import { useExtHost } from "@/features/exthost/store";
import { EXTENSIONS_ENABLED } from "@/features/extensions/flag";
import { startDocSync } from "@/features/exthost/docSync";
import { ExtHostUi } from "@/features/exthost/ExtHostUi";
import { ensureInlineEditEvents, useInlineEdit } from "@/stores/inlineEdit";
import { ensureTerminalEvents, useTerminal } from "@/stores/terminal";
import { ensureChangeEvents } from "@/stores/changes";
import { PermissionGate, ensurePermissionEvents } from "@/features/chat/PermissionGate";
import { QuestionGate, ensureQuestionEvents } from "@/features/chat/QuestionGate";
import { AgentToasts, agentNotice } from "@/lib/notify";
import { backgroundCheckDue, checkForUpdate } from "@/lib/updater";
import { appLang, isRuLike as isRuLikeLang } from "@/i18n/ruLike";
import { rt as rtText } from "@/i18n/tgMap";
import { useGit } from "@/features/git/store";
import { installDropGuard } from "@/lib/dnd";
import { startAppBridge } from "@/lib/appBridge";

import { useRecent } from "@/stores/recent";

export default function App() {
  return (
    <I18nProvider>
      <AppInner />
    </I18nProvider>
  );
}

function AppInner() {
  const { t } = useI18n();
  const mode = useUi((s) => s.mode);
  const settingsOpen = useUi((s) => s.settingsOpen);
  const sidebarVisible = useUi((s) => s.sidebarVisible);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const rightPanelVisible = useUi((s) => s.rightPanelVisible);
  const sidebarWidth = useUi((s) => s.sidebarWidth);
  const setSidebarWidth = useUi((s) => s.setSidebarWidth);
  const rightPanelWidth = useUi((s) => s.rightPanelWidth);
  const setRightPanelWidth = useUi((s) => s.setRightPanelWidth);
  const terminalVisible = useUi((s) => s.terminalVisible);
  const browserDock = useUi((s) => s.browserDock);
  const toggleTerminal = useUi((s) => s.toggleTerminal);
  const activeId = useTabs((s) => s.activeId);
  const close = useTabs((s) => s.close);
  const save = useTabs((s) => s.save);
  const openFolder = useWorkspace((s) => s.openFolder);
  const openPalette = useCommands((s) => s.openWithT);

  useEffect(() => {
    ensureAiEvents();
    ensureInlineEditEvents();
    ensureTerminalEvents();
    ensureChangeEvents();
    ensurePermissionEvents();
    ensureQuestionEvents();
    void useAi.getState().refreshKey();
    // Extension system is switched off for now (code kept): no catalog refresh, no extension host process.
    if (EXTENSIONS_ENABLED) {
      void useExtensions.getState().refresh();
      startDocSync();
      void useExtHost.getState().start();
    }
    void useWorkspace.getState().restore();
  }, []);

  // Once a day, a quiet look for a new version (installed app only): a toast points to Settings → Updates.
  useEffect(() => {
    if (!import.meta.env.PROD || !backgroundCheckDue()) return;
    const timer = window.setTimeout(() => {
      void checkForUpdate().then((r) => {
        if (r.state === "available") {
          const where = isRuLikeLang(appLang()) ? rtText("Настройки → Обновления") : "Settings → Updates";
          agentNotice("update", `${r.info.version}: ${where}`);
        }
      });
    }, 10_000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = shortcutKey(e);
      if (key === "b") {
        e.preventDefault();
        toggleSidebar();
      } else if (key === "w") {
        e.preventDefault();
        if (activeId) close(activeId);
      } else if (key === "s") {
        e.preventDefault();
        if (activeId) void save(activeId);
      } else if (key === "o") {
        e.preventDefault();
        void openFolder();
      } else if (key === "j") {
        e.preventDefault();
        toggleTerminal();
        if (!terminalVisible) void useTerminal.getState().ensure();
      } else if (key === "f" && e.shiftKey) {
        e.preventDefault();
        useUi.getState().setPanel("search");
      } else if (key === "g" && e.shiftKey) {
        e.preventDefault();
        useUi.getState().setPanel("git");
      } else if (key === "p") {
        e.preventDefault();
        openPalette(t as (key: string) => string);
      } else if (key === "r" && !e.shiftKey) {
        e.preventDefault();
        useRecent.getState().toggle();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleSidebar, activeId, close, save, openFolder, openPalette, t, toggleTerminal, terminalVisible]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const inline = useInlineEdit.getState();
      if (inline.tabId) {
        e.preventDefault();
        if (inline.status === "streaming") inline.cancel();
        else inline.close();
        return;
      }
      if (useCommands.getState().visible) {
        e.preventDefault();
        useCommands.getState().close();
        return;
      }
      if (useRecent.getState().visible) {
        e.preventDefault();
        useRecent.getState().close();
        return;
      }
      const ui = useUi.getState();
      if (ui.settingsOpen) {
        ui.closeSettings();
      } else if (ui.sidebarVisible && ui.activePanel === "search") {
        ui.setPanel("explorer");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // A file dropped outside a chat must not replace the app with that file.
  useEffect(() => installDropGuard(), []);

  // The agent (chat and Kins roles) controls the interface through this bridge.
  useEffect(() => startAppBridge(), []);

  // Commits/checkouts made outside the editor show up when the window regains focus.
  useEffect(() => {
    const onFocus = () => {
      if (useGit.getState().loaded) void useGit.getState().refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // The agent opens pages in the built-in browser: bring its tab to the front first.
  useEffect(() => {
    const un = listen<string | { url: string; new_tab?: boolean }>("bv-agent-open", (e) => {
      // The page opens where the user is: the right panel's tab in IDE, a side panel in Vibe and Design.
      // The window never jumps to another mode.
      if (useUi.getState().mode === "ide") useUi.setState({ settingsOpen: false, rightPanelVisible: true, rightTab: "browser" });
      else useUi.setState({ settingsOpen: false, browserDock: true });
      const url = typeof e.payload === "string" ? e.payload : e.payload.url;
      if (typeof url === "string") useBrowserIntent.getState().set(url);
    });
    return () => void un.then((fn) => fn());
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    const unlisten = listen<string[]>("fs-change", (event) => {
      const paths = event.payload;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => handleFsChange(paths), 300);
    });
    return () => {
      window.clearTimeout(timer);
      void unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <div className="aide-shell flex h-screen flex-col overflow-hidden text-ink-200">
      <TitleBar />
      {/* One stable box around the switchable views: switching IDE / Design / Vibe / Settings animates it. */}
      <div className="aide-vt-main flex min-h-0 flex-1 flex-col">
      {settingsOpen ? (
        <main className="aide-island aide-editor-surface mx-1.5 flex min-h-0 flex-1">
          <SettingsPage />
        </main>
      ) : mode === "design" || mode === "vibe" ? (
        <div className="flex min-h-0 min-w-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">{mode === "design" ? <DesignView /> : <VibeView />}</div>
          {browserDock && <BrowserDock />}
        </div>
      ) : (
      <div className="flex min-h-0 flex-1 px-1.5">
        {sidebarVisible && (
          <>
            <Sidebar />
            <ResizeHandle
              axis="x"
              label="Resize sidebar"
              value={sidebarWidth}
              onChange={setSidebarWidth}
            />
          </>
        )}
        <EditorArea />
        {rightPanelVisible && (
          <>
            <ResizeHandle
              axis="x"
              invert
              label="Resize chat panel"
              value={rightPanelWidth}
              onChange={setRightPanelWidth}
            />
            <RightPanel />
          </>
        )}
      </div>
      )}
      </div>
      <StatusBar />
      <CommandPalette />
      <RecentProjects />
      <PermissionGate />
      <QuestionGate />
      <AgentToasts />
      <ExtHostUi />
    </div>
  );
}

function handleFsChange(paths: string[]) {
  void useTree.getState().refreshParents(paths);
  // Saved/created/deleted files change the git status (the .git folder itself is not watched).
  if (useGit.getState().loaded) void useGit.getState().refresh();
  for (const path of paths) {
    const tab = useTabs.getState().tabs.find((t) => t.path === path);
    if (tab && !tab.dirty && !tab.media) {
      fs.readFile(path)
        .then((content) => {
          const current = useTabs.getState().tabs.find((t) => t.path === path);
          if (current && !current.dirty) {
            useTabs.setState((s) => ({
              tabs: s.tabs.map((t) => (t.path === path ? { ...t, content } : t)),
            }));
          }
        })
        .catch(() => {});
    }
  }
}
