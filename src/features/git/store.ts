import { create } from "zustand";
import { git, type GitStatus } from "@/api/git";
import { useWorkspace } from "@/stores/workspace";
import { featureText } from "@/i18n/features";
import { isStaged } from "@/features/git/model";

interface GitState {
  status: GitStatus | null;
  /** At least one status request finished for the current folder. */
  loaded: boolean;
  loading: boolean;
  /** A stage/unstage/discard/commit is running. */
  busy: boolean;
  /** Error of the last action (shown in the panel). */
  error: string | null;
  /** Error of the last status request. */
  statusError: string | null;
  message: string;
  setMessage: (message: string) => void;
  clearError: () => void;
  refresh: () => Promise<void>;
  stage: (paths: string[]) => Promise<void>;
  unstage: (paths: string[]) => Promise<void>;
  discard: (paths: string[]) => Promise<void>;
  /** Returns the short hash, or null when nothing was committed. */
  commit: () => Promise<string | null>;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// One status request at a time; calls made meanwhile cause exactly one re-run.
let inflight: Promise<void> | null = null;
let again = false;

export const useGit = create<GitState>((set, get) => {
  const act = async (fn: () => Promise<unknown>) => {
    set({ busy: true, error: null });
    try {
      await fn();
    } catch (e) {
      set({ error: errText(e) });
    } finally {
      set({ busy: false });
      await get().refresh();
    }
  };

  return {
    status: null,
    loaded: false,
    loading: false,
    busy: false,
    error: null,
    statusError: null,
    message: "",
    setMessage: (message) => set({ message }),
    clearError: () => set({ error: null }),
    refresh: () => {
      if (inflight) {
        again = true;
        return inflight;
      }
      const run = async () => {
        do {
          again = false;
          if (!useWorkspace.getState().root) {
            set({ status: null, loaded: true, statusError: null });
            return;
          }
          set({ loading: true });
          try {
            const status = await git.status();
            set({ status, loaded: true, statusError: null });
          } catch (e) {
            set({ status: null, loaded: true, statusError: errText(e) });
          }
        } while (again);
      };
      inflight = run().finally(() => {
        inflight = null;
        set({ loading: false });
      });
      return inflight;
    },
    stage: (paths) => act(() => git.stage(paths)),
    unstage: (paths) => act(() => git.unstage(paths)),
    discard: (paths) => act(() => git.discard(paths)),
    commit: async () => {
      const ft = featureText();
      const message = get().message.trim();
      if (!message) {
        set({ error: ft.commitPlaceholder });
        return null;
      }
      if (!get().status?.files.some(isStaged)) {
        set({ error: ft.nothingStaged });
        return null;
      }
      let hash: string | null = null;
      await act(async () => {
        hash = await git.commit(message);
        set({ message: "" });
      });
      return hash;
    },
  };
});

// A different folder means a different repository (or none).
useWorkspace.subscribe((s, prev) => {
  if (s.root === prev.root) return;
  useGit.setState({ status: null, loaded: false, error: null, statusError: null, message: "" });
  void useGit.getState().refresh();
});
