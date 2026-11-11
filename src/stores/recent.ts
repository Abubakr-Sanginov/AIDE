import { create } from "zustand";

interface RecentState {
  visible: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

export const useRecent = create<RecentState>((set) => ({
  visible: false,
  open: () => set({ visible: true }),
  close: () => set({ visible: false }),
  toggle: () => set((s) => ({ visible: !s.visible })),
}));
