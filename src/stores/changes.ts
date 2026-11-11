import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Files the agent changed, per answer (request id). Fed by the backend's checkpoints,
// which also hold the originals needed to undo them.

interface ChangesState {
  byRequest: Record<string, { paths: string[]; allRestorable: boolean }>;
  undone: Record<string, string[]>;
  undo: (requestId: string) => Promise<string | null>;
}

export const useChanges = create<ChangesState>((set, get) => ({
  byRequest: {},
  undone: {},
  undo: async (requestId) => {
    try {
      const restored = await invoke<string[]>("agent_undo", { requestId });
      const { [requestId]: _gone, ...rest } = get().byRequest;
      void _gone;
      set({ byRequest: rest, undone: { ...get().undone, [requestId]: restored } });
      return null;
    } catch (e) {
      return String(e);
    }
  },
}));

let inited = false;
export function ensureChangeEvents() {
  if (inited) return;
  inited = true;
  void listen<{ request_id: string; path: string; restorable: boolean }>("ai-checkpoint", (e) => {
    const { request_id, path, restorable } = e.payload;
    useChanges.setState((s) => {
      const cur = s.byRequest[request_id] ?? { paths: [], allRestorable: true };
      if (cur.paths.includes(path)) return s;
      return { byRequest: { ...s.byRequest, [request_id]: { paths: [...cur.paths, path], allRestorable: cur.allRestorable && restorable } } };
    });
  });
}
