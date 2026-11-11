import { create } from "zustand";
import { useTabs } from "@/stores/tabs";
import { useWorkspace } from "@/stores/workspace";
import { useUi } from "@/stores/ui";
import { useAi } from "@/stores/ai";
import { useExtHost } from "@/features/exthost/store";
import { formatView } from "@/features/exthost/cm";
import { viewFor } from "@/features/exthost/views";
import { addCursorAbove, addCursorBelow } from "@codemirror/commands";
import { selectNextOccurrence, selectSelectionMatches } from "@codemirror/search";
import { featureText } from "@/i18n/features";
import { useGit } from "@/features/git/store";
import { compareWithSaved } from "@/features/diff/open";
import { newSnippetFromSelection } from "@/features/snippets/actions";
import { cursorsAtLineEnds, runOnActive } from "@/lib/multiCursor";

export interface CommandItem {
  id: string;
  title: string;
  hint?: string;
  run: () => void;
}

interface CommandsState {
  visible: boolean;
  items: CommandItem[];
  open: () => void;
  openWithT: (t: (key: string) => string) => void;
  close: () => void;
  run: (id: string) => void;
}

function buildItems(t: (key: string) => string): CommandItem[] {
  const tabs = useTabs.getState();
  const { openFolder } = useWorkspace.getState();
  const ui = useUi.getState();
  const activeId = tabs.activeId;
  return [
    {
      id: "open-folder",
      title: t("command.openFolder"),
      hint: "Ctrl+O",
      run: () => void openFolder(),
    },
    {
      id: "save",
      title: t("command.saveFile"),
      hint: "Ctrl+S",
      run: () => {
        if (activeId) void tabs.save(activeId);
      },
    },
    {
      id: "close-tab",
      title: t("command.closeTab"),
      hint: "Ctrl+W",
      run: () => {
        if (activeId) tabs.close(activeId);
      },
    },
    {
      id: "toggle-sidebar",
      title: t("command.toggleSidebar"),
      hint: "Ctrl+B",
      run: ui.toggleSidebar,
    },
    { id: "panel-explorer", title: t("command.openExplorer"), run: () => ui.setPanel("explorer") },
    { id: "panel-search", title: t("command.openSearch"), run: () => ui.setPanel("search") },
    { id: "panel-settings", title: t("command.openSettings"), run: () => ui.setPanel("settings") },
    {
      id: "toggle-chat",
      title: t("command.toggleChat"),
      run: ui.toggleRightPanel,
    },
    { id: "chat-clear", title: t("command.clearChat"), run: () => useAi.getState().clear() },
    {
      id: "ai-mode-chat",
      title: t("command.modeChat"),
      run: () => {
        useAi.getState().setMode("chat");
        if (!useUi.getState().rightPanelVisible) ui.toggleRightPanel();
      },
    },
    {
      id: "ai-mode-plan",
      title: t("command.modePlan"),
      run: () => {
        useAi.getState().setMode("plan");
        if (!useUi.getState().rightPanelVisible) ui.toggleRightPanel();
      },
    },
    {
      id: "ai-mode-agent",
      title: t("command.modeAgent"),
      run: () => {
        useAi.getState().setMode("agent");
        if (!useUi.getState().rightPanelVisible) ui.toggleRightPanel();
      },
    },
    ...featureItems(),
    ...extensionItems(),
  ];
}

/** Source control, diff, multi-cursor and snippet commands. */
function featureItems(): CommandItem[] {
  const ft = featureText();
  const ui = useUi.getState();
  const tabs = useTabs.getState();
  const active = tabs.tabs.find((x) => x.id === tabs.activeId);
  const items: CommandItem[] = [
    { id: "git-open", title: ft.cmdOpenScm, hint: "Ctrl+Shift+G", run: () => ui.setPanel("git") },
    { id: "git-refresh", title: ft.cmdGitRefresh, run: () => void useGit.getState().refresh() },
    { id: "snippets-open", title: ft.cmdOpenSnippets, run: () => ui.setPanel("snippets") },
  ];
  if (!active) return items;
  items.push(
    { id: "snippet-new", title: ft.cmdNewSnippet, run: () => newSnippetFromSelection(active.path) },
    { id: "diff-saved", title: ft.cmdCompareSaved, run: () => void compareWithSaved(active) },
    { id: "mc-above", title: ft.cmdCursorAbove, hint: "Ctrl+Alt+↑", run: () => runOnActive(addCursorAbove) },
    { id: "mc-below", title: ft.cmdCursorBelow, hint: "Ctrl+Alt+↓", run: () => runOnActive(addCursorBelow) },
    { id: "mc-next", title: ft.cmdNextOccurrence, hint: "Ctrl+D", run: () => runOnActive(selectNextOccurrence) },
    { id: "mc-all", title: ft.cmdAllOccurrences, hint: "Ctrl+Shift+L", run: () => runOnActive(selectSelectionMatches) },
    { id: "mc-ends", title: ft.cmdLineEnds, hint: "Shift+Alt+I", run: () => runOnActive(cursorsAtLineEnds) },
  );
  return items;
}

/** Commands contributed by trusted extensions (shown once the extension host is running). */
function extensionItems(): CommandItem[] {
  const host = useExtHost.getState();
  const items: CommandItem[] = [];
  const tabs = useTabs.getState();
  const active = tabs.tabs.find((x) => x.id === tabs.activeId);
  if (host.status === "ready" && active) {
    items.push({
      id: "ext-format",
      title: "Format Document",
      hint: "Shift+Alt+F",
      run: () => {
        const v = viewFor(active.path);
        if (v) void formatView(v, active.path).catch((e) => useTabs.getState().setError(String(e)));
      },
    });
  }
  if (host.status !== "ready") return items;
  const seen = new Set<string>();
  for (const c of host.manifestCommands) {
    seen.add(c.id);
    items.push({ id: "ext:" + c.id, title: c.title, run: () => void host.runCommand(c.id).catch((e) => useTabs.getState().setError(String(e instanceof Error ? e.message : e))) });
  }
  for (const id of Object.keys(host.registered)) {
    if (seen.has(id) || id.startsWith("_")) continue;
    items.push({ id: "ext:" + id, title: id, run: () => void host.runCommand(id).catch((e) => useTabs.getState().setError(String(e instanceof Error ? e.message : e))) });
  }
  return items;
}

export const useCommands = create<CommandsState>((set, get) => ({
  visible: false,
  items: [],
  open: () => set({ visible: true, items: [] }),
  openWithT: (t: (key: string) => string) => set({ visible: true, items: buildItems(t) }),
  close: () => set({ visible: false }),
  run: (id) => {
    const item = get().items.find((i) => i.id === id);
    set({ visible: false });
    item?.run();
  },
}));