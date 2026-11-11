import { useEffect } from "react";
import { useTabs } from "@/stores/tabs";
import { useUi } from "@/stores/ui";
import { ResizeHandle } from "@/shell/ResizeHandle";
import { TabBar } from "@/features/editor/TabBar";
import { CodeEditor } from "@/features/editor/CodeEditor";
import { WelcomeScreen } from "@/features/welcome/WelcomeScreen";
import { SettingsPage } from "@/features/settings/SettingsPanel";
import { TerminalPanel } from "@/features/terminal/TerminalPanel";
import { DiffView } from "@/features/diff/DiffView";
import { MediaViewer } from "@/features/editor/MediaViewer";
import { useDiff } from "@/features/diff/store";

// The single rounded "island": editor on top, tabbed terminal dock below.
export function EditorArea() {
  const tabs = useTabs((s) => s.tabs);
  const activeId = useTabs((s) => s.activeId);
  const terminalVisible = useUi((s) => s.terminalVisible);
  const terminalHeight = useUi((s) => s.terminalHeight);
  const setTerminalHeight = useUi((s) => s.setTerminalHeight);
  const settingsOpen = useUi((s) => s.settingsOpen);
  const active = tabs.find((t) => t.id === activeId) ?? null;
  const diffDoc = useDiff((s) => s.doc);
  const diffActive = useDiff((s) => s.active);

  // Opening / switching a file brings the editor back.
  useEffect(() => {
    if (activeId) useUi.getState().closeSettings();
  }, [activeId]);

  return (
    <main className="aide-island aide-editor-surface aide-vt-editor flex min-h-0 min-w-0 flex-1 flex-col">
      {settingsOpen ? (
        <SettingsPage />
      ) : (
        <>
          <TabBar />
          <div className="aide-vt-editor-body flex min-h-0 flex-1 flex-col">
            {diffActive && diffDoc ? (
              <DiffView key={diffDoc.nonce} doc={diffDoc} />
            ) : active ? (
              active.media ? <MediaViewer key={active.id} tab={active} /> : <CodeEditor key={active.id} tab={active} />
            ) : (
              <WelcomeScreen />
            )}
          </div>
        </>
      )}
      {terminalVisible && (
        <>
          <ResizeHandle
            axis="y"
            invert
            label="Resize terminal"
            value={terminalHeight}
            onChange={setTerminalHeight}
          />
          <TerminalPanel />
        </>
      )}
    </main>
  );
}
