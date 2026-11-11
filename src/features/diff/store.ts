import { create } from "zustand";
import { useTabs } from "@/stores/tabs";
import { useUi } from "@/stores/ui";

export interface DiffDoc {
  title: string;
  /** Absolute path: language detection and "Open file". */
  path: string;
  left: string;
  right: string;
  leftLabel: string;
  rightLabel: string;
  /** New value for every opened diff (remounts the view). */
  nonce: number;
}

interface DiffState {
  doc: DiffDoc | null;
  /** The diff is shown in the editor area (the doc can stay as a tab chip). */
  active: boolean;
  loading: boolean;
  show: (doc: Omit<DiffDoc, "nonce">) => void;
  activate: () => void;
  hide: () => void;
  close: () => void;
  setLoading: (loading: boolean) => void;
}

let nonce = 0;

export const useDiff = create<DiffState>((set) => ({
  doc: null,
  active: false,
  loading: false,
  show: (doc) => {
    useUi.getState().closeSettings();
    set({ doc: { ...doc, nonce: ++nonce }, active: true });
  },
  activate: () => {
    useUi.getState().closeSettings();
    set((s) => ({ active: s.doc !== null }));
  },
  hide: () => set({ active: false }),
  close: () => set({ doc: null, active: false }),
  setLoading: (loading) => set({ loading }),
}));

// Any tab navigation (switching, reopening the active file, go-to-line) brings the editor back.
// While the diff is shown no editor is mounted, so these fields change only on navigation.
useTabs.subscribe((s, prev) => {
  if (!useDiff.getState().active) return;
  if (s.activeId !== prev.activeId || s.cursor !== prev.cursor || s.pendingGoto !== prev.pendingGoto) {
    useDiff.getState().hide();
  }
});
