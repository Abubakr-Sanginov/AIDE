import { create } from "zustand";
import { open } from "@tauri-apps/plugin-dialog";
import { fs } from "@/api/fs";
import { useTree } from "@/stores/tree";
import { useTabs } from "@/stores/tabs";
import { useChats } from "@/stores/chats";
import { flushPersist, useAi } from "@/stores/ai";
import { t } from "@/i18n/t";

interface WorkspaceState {
  root: string | null;
  opening: boolean;
  recents: string[];
  openFolder: () => Promise<void>;
  openPath: (path: string) => Promise<void>;
  removeRecent: (path: string) => void;
  clearRecents: () => void;
  restore: () => Promise<void>;
}

const ROOT_KEY = "aide.workspaceRoot";
const RECENTS_KEY = "aide.recentFolders";

function loadRecents(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function pushRecent(path: string) {
  const list = [path, ...loadRecents().filter((p) => p !== path)].slice(0, 50);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
}

function dropRecent(path: string) {
  const list = loadRecents().filter((p) => p !== path);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  root: null,
  opening: false,
  recents: loadRecents(),
  openFolder: async () => {
    if (get().opening) return;
    set({ opening: true });
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t("workspace.openFolder"),
      });
      if (typeof selected === "string" && selected) {
        await get().openPath(selected);
      }
    } catch (e) {
      useTabs.getState().setError(t("workspace.errorOpen", { error: String(e) }));
    } finally {
      set({ opening: false });
    }
  },
  openPath: async (path) => {
    await fs.openWorkspace(path);
    // Новая рабочая область: чистим дерево и вкладки старой.
    useTree.getState().reset();
    useTabs.getState().clearAll();
    useTabs.getState().setError(null);
    // An answer still streaming belongs to the project we are leaving: stop it
    // here, otherwise it would finish inside the next project's chat.
    if (useAi.getState().streaming) useAi.getState().stop();
    // Write the pending history under the old project's key before the root changes.
    flushPersist();
    // The new root is written first: everything that saves "the current chat"
    // from here on must land under the new project, never the old one.
    localStorage.setItem(ROOT_KEY, path);
    // Chats follow the project: archive the previous project's chat, then show
    // only the chats of this project.
    useChats.getState().setRoot(path);
    pushRecent(path);
    set({ root: path, recents: loadRecents() });
  },
  removeRecent: (path) => {
    dropRecent(path);
    set({ recents: loadRecents() });
  },
  clearRecents: () => {
    localStorage.removeItem(RECENTS_KEY);
    set({ recents: [] });
  },
  restore: async () => {
    const saved = localStorage.getItem(ROOT_KEY);
    if (!saved) return;
    try {
      await get().openPath(saved);
    } catch {
      localStorage.removeItem(ROOT_KEY);
    }
  },
}));
