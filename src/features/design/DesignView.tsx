import { useEffect } from "react";
import { ResizeHandle } from "@/shell/ResizeHandle";
import { Canvas } from "@/features/design/Canvas";
import { CodeView } from "@/features/design/CodeView";
import { DesignPanel } from "@/features/design/DesignPanel";
import { SiteDialog } from "@/features/design/SiteDialog";
import { CreateProjectDialog } from "@/features/design/CreateProjectDialog";
import { ensureDesignEvents, useDesign } from "@/features/design/store";

// "Design" section: AI-only design workspace. Left: chat + layers.
// Center: canvas (or read-only code). Text is never edited directly on the
// canvas — select an element and describe the change in the chat.
export function DesignView() {
  const view = useDesign((s) => s.view);
  const panelWidth = useDesign((s) => s.panelWidth);
  const setPanelWidth = useDesign((s) => s.setPanelWidth);

  useEffect(() => {
    ensureDesignEvents();
  }, []);

  return (
    <div className="flex min-h-0 flex-1 px-1.5">
      <DesignPanel />
      <ResizeHandle axis="x" label="Resize design panel" value={panelWidth} onChange={setPanelWidth} />
      <main className="aide-island aide-editor-surface aide-vt-design-body flex min-h-0 min-w-0 flex-1 flex-col">
        {view === "canvas" ? <Canvas /> : <CodeView />}
      </main>
      <SiteDialog />
      <CreateProjectDialog />
    </div>
  );
}
