import { create } from "zustand";
import { fs, type FsEntry } from "@/api/fs";
import { dirname } from "@/lib/fsUtils";

interface TreeState {
  /** Дети папки по её пути — кэш лениво загружаемых узлов дерева. */
  cache: Record<string, FsEntry[]>;
  /** Какие папки раскрыты. Хранится отдельно от кэша, чтобы не терять
   *  состояние раскрытия при обновлении содержимого из fs-change. */
  expanded: Record<string, boolean>;
  /** Ошибка последней загрузки папки (показываем в дереве, а не молчим). */
  error: string | null;
  loadDir: (path: string, force?: boolean) => Promise<void>;
  toggleDir: (path: string) => Promise<void>;
  /** Свернуть все папки (кэш содержимого остаётся). */
  collapseAll: () => void;
  refreshParents: (paths: string[]) => Promise<void>;
  reset: () => void;
}

export const useTree = create<TreeState>((set, get) => ({
  cache: {},
  expanded: {},
  error: null,
  collapseAll: () => set({ expanded: {} }),
  loadDir: async (path, force = false) => {
    if (!force && get().cache[path]) return;
    try {
      const entries = await fs.listDir(path);
      set((s) => ({ cache: { ...s.cache, [path]: entries }, error: null }));
    } catch (e) {
      // Папка могла быть удалена извне — показываем ошибку и даём повторить.
      console.error("list_dir:", path, e);
      set({ error: String(e) });
    }
  },
  toggleDir: async (path) => {
    const willOpen = !get().expanded[path];
    set((s) => ({ expanded: { ...s.expanded, [path]: willOpen } }));
    if (willOpen) await get().loadDir(path);
  },
  // Реакция на fs-change: перечитываем только уже загруженные папки.
  refreshParents: async (paths) => {
    const dirs = new Set<string>();
    for (const p of paths) {
      dirs.add(dirname(p));
      if (get().cache[p]) dirs.add(p);
    }
    await Promise.all(
      [...dirs].filter((d) => get().cache[d]).map((d) => get().loadDir(d, true)),
    );
  },
  reset: () => set({ cache: {}, expanded: {}, error: null }),
}));
