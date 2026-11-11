import { create } from "zustand";
import { fs } from "@/api/fs";
import { basename, detectLanguage, mediaKindOf, type MediaKind } from "@/lib/fsUtils";
import { t } from "@/i18n/t";
import { withViewTransitions, type VtDir, type VtRegion } from "@/lib/motion";

export interface Tab {
  id: string; // id = путь к файлу
  path: string;
  name: string;
  language: string;
  content: string;
  dirty: boolean;
  /** Photo, video, sound or PDF: shown by the media viewer, never edited or saved. */
  media?: MediaKind;
}

interface TabsState {
  tabs: Tab[];
  activeId: string | null;
  /** `sel` = number of selections/cursors (multi-cursor), 1 by default. */
  cursor: { line: number; col: number; sel?: number };
  error: string | null;
  pendingInsert: { text: string; nonce: number } | null;
  pendingGoto: { line: number; col: number } | null;
  open: (path: string) => Promise<void>;
  close: (id: string) => void;
  closeByPath: (path: string) => void;
  clearAll: () => void;
  setActive: (id: string) => void;
  setContent: (id: string, content: string) => void;
  setCursor: (line: number, col: number, sel?: number) => void;
  goto: (path: string, line: number, col: number) => Promise<void>;
  save: (id: string) => Promise<void>;
  rename: (oldPath: string, newPath: string) => void;
  setError: (msg: string | null) => void;
  requestInsert: (text: string) => void;
  clearInsert: () => void;
  clearGoto: () => void;
}

// Защита от двойного клика: пока файл грузится, второй таб не открываем.
const pending = new Set<string>();

/** Switching to another file slides the editor towards that tab's side; opening the first one rises in. */
function editorSwitch(prev: TabsState, next: Partial<TabsState>): { region: VtRegion; dir?: VtDir } | null {
  if (!("activeId" in next) || next.activeId === prev.activeId) return null;
  const tabs = next.tabs ?? prev.tabs;
  const from = prev.tabs.findIndex((t) => t.id === prev.activeId);
  const to = tabs.findIndex((t) => t.id === next.activeId);
  if (from < 0 || to < 0 || from === to) return { region: "editor" };
  return { region: "editor", dir: to > from ? "next" : "prev" };
}

export const useTabs = create<TabsState>(withViewTransitions<TabsState>(editorSwitch, (set, get) => ({
  tabs: [],
  activeId: null,
  cursor: { line: 1, col: 1 },
  error: null,
  pendingInsert: null,
  pendingGoto: null,
  open: async (path) => {
    const existing = get().tabs.find((t) => t.path === path);
    if (existing) {
      set({ activeId: existing.id, cursor: { line: 1, col: 1 } });
      return;
    }
    if (pending.has(path)) return;
    pending.add(path);
    try {
      const media = mediaKindOf(path);
      const content = media ? "" : await fs.readFile(path);
      const tab: Tab = {
        id: path,
        path,
        name: basename(path),
        language: detectLanguage(path),
        content,
        dirty: false,
        media,
      };
      set((s) => ({
        tabs: [...s.tabs, tab],
        activeId: tab.id,
        cursor: { line: 1, col: 1 },
      }));
    } catch (e) {
      set({ error: t("tabs.errorOpen", { name: basename(path), error: String(e) }) });
    } finally {
      pending.delete(path);
    }
  },
  close: (id) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id);
      const activeId =
        s.activeId === id ? tabs[tabs.length - 1]?.id ?? null : s.activeId;
      return { tabs, activeId };
    }),
  closeByPath: (path) => get().close(path),
  clearAll: () => set({ tabs: [], activeId: null, cursor: { line: 1, col: 1 } }),
  setActive: (activeId) => set({ activeId, cursor: { line: 1, col: 1 } }),
  setContent: (id, content) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, content, dirty: true } : t)),
    })),
  setCursor: (line, col, sel = 1) => set({ cursor: { line, col, sel } }),
  goto: async (path, line, col) => {
    set({ pendingGoto: { line, col } });
    await get().open(path);
  },
  clearGoto: () => set({ pendingGoto: null }),
  save: async (id) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab || !tab.dirty) return;
    try {
      await fs.writeFile(tab.path, tab.content);
      set((s) => ({
        tabs: s.tabs.map((t) => (t.id === id ? { ...t, dirty: false } : t)),
      }));
    } catch (e) {
      set({ error: t("tabs.errorSave", { name: tab.name, error: String(e) }) });
    }
  },
  rename: (oldPath, newPath) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === oldPath
          ? {
              ...t,
              id: newPath,
              path: newPath,
              name: basename(newPath),
              language: detectLanguage(newPath),
            }
          : t,
      ),
      activeId: s.activeId === oldPath ? newPath : s.activeId,
    })),
  setError: (error) => set({ error }),
  requestInsert: (text) => set({ pendingInsert: { text, nonce: Date.now() } }),
  clearInsert: () => set({ pendingInsert: null }),
})));
