import { create } from "zustand";
import { dirOf, withViewTransitions, type VtDir, type VtRegion } from "@/lib/motion";

export type SidebarPanel = "explorer" | "search" | "git" | "snippets" | "settings";

export type AppMode = "ide" | "design" | "vibe";

// Order of things on screen, so a switch slides the way the eye expects.
const MODE_ORDER: AppMode[] = ["vibe", "ide", "design"];
const PANEL_ORDER: SidebarPanel[] = ["explorer", "search", "git", "snippets"];
const RIGHT_ORDER = ["chat", "kins", "browser"];
const DOCK_ORDER: DockTab[] = ["problems", "output", "terminal", "agent"];

/** Which switch a state change is, if any (see withViewTransitions). */
function transitionOf(prev: UiState, next: Partial<UiState>): { region: VtRegion; dir?: VtDir } | null {
  const changed = (k: keyof UiState) => k in next && next[k] !== prev[k];
  if (changed("settingsOpen")) return { region: "main", dir: next.settingsOpen ? "zoom" : "unzoom" };
  if (changed("mode")) return { region: "main", dir: dirOf(MODE_ORDER, prev.mode, next.mode as AppMode) };
  if (changed("sidebarVisible") || changed("rightPanelVisible") || changed("terminalVisible") || changed("browserDock")) return { region: "layout" };
  if (changed("activePanel")) return { region: "sidebar", dir: dirOf(PANEL_ORDER, prev.activePanel, next.activePanel as SidebarPanel) };
  if (changed("rightTab")) return { region: "right", dir: dirOf(RIGHT_ORDER, prev.rightTab, next.rightTab as string) };
  if (changed("dockTab")) return { region: "dock", dir: dirOf(DOCK_ORDER, prev.dockTab, next.dockTab as DockTab) };
  return null;
}
/** "chat", "kins", "browser", or the id of an extension webview. */
export type RightTab = string;
export type DockTab = "problems" | "output" | "terminal" | "agent";

interface UiState {
  mode: AppMode;
  rightTab: RightTab;
  dockTab: DockTab;
  setDockTab: (t: DockTab) => void;
  /** Built-in browser as a side panel in Vibe and Design (IDE uses a tab of the right panel). */
  browserDock: boolean;
  setBrowserDock: (open: boolean) => void;
  setRightTab: (t: RightTab) => void;
  settingsOpen: boolean;
  closeSettings: () => void;
  setMode: (mode: AppMode) => void;
  sidebarVisible: boolean;
  sidebarWidth: number;
  activePanel: SidebarPanel;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  setPanel: (panel: SidebarPanel) => void;
  rightPanelVisible: boolean;
  rightPanelWidth: number;
  toggleRightPanel: () => void;
  setRightPanelWidth: (width: number) => void;
  terminalVisible: boolean;
  terminalHeight: number;
  toggleTerminal: () => void;
  setTerminalHeight: (height: number) => void;
}

export const useUi = create<UiState>(withViewTransitions<UiState>(transitionOf, (set) => ({
  mode: "ide",
  rightTab: "chat",
  dockTab: "terminal",
  setDockTab: (dockTab) => set({ dockTab }),
  browserDock: false,
  setBrowserDock: (browserDock) => set({ browserDock }),
  setRightTab: (rightTab) => set({ rightTab }),
  settingsOpen: false,
  closeSettings: () => set({ settingsOpen: false }),
  setMode: (mode) => set({ mode }),
  sidebarVisible: true,
  sidebarWidth: 250,
  activePanel: "explorer",
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  setSidebarWidth: (width) =>
    set({ sidebarWidth: Math.min(480, Math.max(180, Math.round(width))) }),
  // "settings" opens the full settings page; other panels live in the sidebar.
  setPanel: (panel) =>
    panel === "settings"
      ? set({ settingsOpen: true, mode: "ide" })
      : set({ activePanel: panel, sidebarVisible: true, settingsOpen: false }),
  rightPanelVisible: true,
  rightPanelWidth: 400,
  toggleRightPanel: () => set((s) => ({ rightPanelVisible: !s.rightPanelVisible })),
  setRightPanelWidth: (width) =>
    set({ rightPanelWidth: Math.min(680, Math.max(320, Math.round(width))) }),
  terminalVisible: true,
  terminalHeight: 224,
  toggleTerminal: () => set((s) => ({ terminalVisible: !s.terminalVisible })),
  setTerminalHeight: (height) =>
    set({ terminalHeight: Math.min(480, Math.max(120, Math.round(height))) }),
})));
