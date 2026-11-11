import { create } from "zustand";
import { extApi, loadTheme, parseManifest, type ExtInfo, type VsTheme } from "./manifest";

const THEME_KEY = "aide.ext.theme";

export interface ThemeChoice {
  key: string; // "<extId>::<label>"
  extId: string;
  label: string;
  uiTheme?: string;
  path: string;
}

interface ExtState {
  installed: ExtInfo[];
  loaded: boolean;
  themeKey: string | null;
  theme: VsTheme | null;
  /** Bumps whenever editors must rebuild theme/snippets/grammars. */
  rev: number;
  busy: string | null;
  error: string | null;
  /** A package above the size threshold waiting for the user's consent. */
  large: { namespace: string; name: string; bytes: number } | null;
  dismissLarge: () => void;
  refresh: () => Promise<void>;
  install: (namespace: string, name: string, confirmLarge?: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** `remember`: false when re-applying the saved choice, so a failed load never erases it. */
  setTheme: (key: string | null, remember?: boolean) => Promise<void>;
  themes: () => ThemeChoice[];
}

const message = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : String(e));

export const useExtensions = create<ExtState>((set, get) => ({
  installed: [],
  loaded: false,
  themeKey: (() => {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch {
      return null;
    }
  })(),
  theme: null,
  rev: 0,
  busy: null,
  error: null,
  large: null,
  dismissLarge: () => set({ large: null }),

  themes: () =>
    get().installed.flatMap((e) => e.themes.map((t) => ({ key: `${e.id}::${t.label}`, extId: e.id, label: t.label, uiTheme: t.uiTheme, path: t.path }))),

  refresh: async () => {
    try {
      const ids = await extApi.list();
      const infos = await Promise.all(
        ids.map(async (id) => {
          try {
            return parseManifest(id, await extApi.read(id, "package.json"));
          } catch {
            return null;
          }
        }),
      );
      set({ installed: infos.filter((i): i is ExtInfo => i !== null), loaded: true });
    } catch (e) {
      set({ loaded: true, error: message(e) });
    }
    await get().setTheme(get().themeKey, false);
  },

  install: async (namespace, name, confirmLarge = false) => {
    if (get().busy) return;
    set({ busy: `${namespace}.${name}`, error: null, large: null });
    try {
      await extApi.install(namespace, name, confirmLarge);
      await get().refresh();
    } catch (e) {
      const m = message(e);
      const big = /^LARGE:(\d+)/.exec(m);
      if (big) set({ large: { namespace, name, bytes: Number(big[1]) } });
      else set({ error: m });
    } finally {
      set({ busy: null });
    }
  },

  remove: async (id) => {
    set({ busy: id, error: null });
    try {
      await extApi.remove(id);
      await get().refresh();
    } catch (e) {
      set({ error: message(e) });
    } finally {
      set({ busy: null });
    }
  },

  setTheme: async (key, remember = true) => {
    const choice = key ? get().themes().find((t) => t.key === key) : undefined;
    let theme: VsTheme | null = null;
    if (choice) {
      try {
        theme = await loadTheme(choice.extId, choice.path, choice.label, choice.uiTheme);
      } catch {
        theme = null;
      }
    }
    if (remember) {
      try {
        if (theme && key) localStorage.setItem(THEME_KEY, key);
        else localStorage.removeItem(THEME_KEY);
      } catch {
        /* storage unavailable */
      }
    }
    set((s) => ({ theme, themeKey: remember ? (theme ? key : null) : s.themeKey, rev: s.rev + 1 }));
  },
}));
