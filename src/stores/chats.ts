import { create } from "zustand";
import { cleanAssistantMessages, persistMessages, useAi } from "@/stores/ai";
import { keyFor, sameRoot } from "@/lib/workspaceKey";

// Chat sessions for the main (IDE) chat, partitioned by project (workspace root).
// The live conversation stays in the AI store as before; this module archives it
// under an id so the user can start a new chat and come back to earlier ones.
// Every archived chat carries the root of the project it was created in, and the
// store only ever exposes (and opens) chats of the currently open project — a
// chat from another project is unreachable here, not just hidden in the UI.

type Msg = ReturnType<typeof useAi.getState>["messages"][number];

export interface ArchivedChat {
  id: string;
  title: string;
  updatedAt: number;
  messages: Msg[];
  /** Project root this chat belongs to. Missing in chats saved before partitioning. */
  root?: string | null;
}

const KEY = "aide.chats";
const ACTIVE = "aide.chat.activeId";
const MAX_CHATS = 200;

function readChats(): ArchivedChat[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((c) => c && typeof c.id === "string" && Array.isArray(c.messages))
      .map((c) => ({
        id: String(c.id),
        title: typeof c.title === "string" ? c.title.slice(0, 80) : "",
        updatedAt: Number(c.updatedAt) || Date.now(),
        messages: cleanAssistantMessages(c.messages as Msg[]),
        root: typeof c.root === "string" ? c.root : null,
      }));
  } catch {
    return [];
  }
}

function writeChats(chats: ArchivedChat[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(chats.slice(0, MAX_CHATS)));
  } catch {
    /* storage full: keep the in-memory list */
  }
}

/** Attachments carry base64 data; do not archive it (storage quota). */
function lite(messages: Msg[]): Msg[] {
  return messages.map((m) => {
    const copy = { ...m } as Msg & { attachments?: unknown };
    if (copy.attachments) delete copy.attachments;
    return copy as Msg;
  });
}

export function titleOf(messages: Msg[]): string {
  const first = messages.find((m) => m.role === "user");
  return (first?.content ?? "").replace(/\s+/g, " ").trim().slice(0, 48);
}

interface ChatsState {
  root: string | null;
  chats: ArchivedChat[];
  activeId: string | null;
  newChat: () => void;
  openChat: (id: string) => void;
  deleteChat: (id: string) => void;
  /** Switch the visible archive (and the live conversation) to another project. */
  setRoot: (root: string | null) => void;
}

// The full archive of every project lives in storage; the state below only
// holds the slice of the currently open project.
let all: ArchivedChat[] = readChats();

/** Writes the live conversation into the full archive under the active id. */
function saveActive(
  s: { activeId: string | null; root: string | null },
  source: ArchivedChat[],
): ArchivedChat[] {
  const messages = useAi.getState().messages;
  if (messages.length === 0) return source;
  const id = s.activeId ?? crypto.randomUUID();
  const entry: ArchivedChat = { id, root: s.root, title: titleOf(messages), updatedAt: Date.now(), messages: lite(messages) };
  return [entry, ...source.filter((c) => c.id !== id)];
}

function activeKey(root: string | null) {
  return keyFor(ACTIVE, root);
}

/** Chats of one project. Roots are compared normalized (slashes, case, trailing "/"). */
const ofRoot = (list: ArchivedChat[], root: string | null) => list.filter((c) => sameRoot(c.root, root));

export const useChats = create<ChatsState>((set, get) => ({
  root: null,
  chats: [],
  activeId: null,

  newChat: () => {
    if (useAi.getState().streaming) return;
    all = saveActive(get(), all);
    writeChats(all);
    const activeId = crypto.randomUUID();
    localStorage.setItem(activeKey(get().root), activeId);
    set({ chats: ofRoot(all, get().root), activeId });
    useAi.getState().clear();
  },

  openChat: (id) => {
    if (useAi.getState().streaming || id === get().activeId) return;
    all = saveActive(get(), all);
    // Only chats of the current project may be opened: anything else (a foreign
    // id, a stale one) is refused instead of being loaded into this project.
    const target = all.find((c) => c.id === id && sameRoot(c.root, get().root));
    if (!target) return;
    writeChats(all);
    localStorage.setItem(activeKey(get().root), id);
    set({ chats: ofRoot(all, get().root), activeId: id });
    useAi.setState({ messages: target.messages, error: null });
    persistMessages(target.messages);
  },

  deleteChat: (id) => {
    if (useAi.getState().streaming) return;
    // A chat of another project cannot be deleted from here either.
    if (!all.some((c) => c.id === id && sameRoot(c.root, get().root))) return;
    all = all.filter((c) => c.id !== id);
    writeChats(all);
    if (id === get().activeId) {
      localStorage.removeItem(activeKey(get().root));
      set({ chats: ofRoot(all, get().root), activeId: null });
      useAi.getState().clear();
    } else {
      set({ chats: ofRoot(all, get().root) });
    }
  },

  setRoot: (root) => {
    if (useAi.getState().streaming) return;
    let list = all;
    if (root) {
      // Migration: chats saved before partitioning have no root. They go to the
      // first project that actually opens, instead of leaking into every project.
      const hasLegacy = list.some((c) => !c.root);
      const hasForNew = list.some((c) => sameRoot(c.root, root));
      if (hasLegacy && !hasForNew) {
        list = list.map((c) => (c.root ? c : { ...c, root }));
      }
    }
    const live = useAi.getState().messages;
    if (get().root === null && root) {
      // First project of this session: the live conversation was loaded for it at
      // startup, so it is archived under it (not under "no project", which would
      // hide it and replace it with an older chat of the same project).
      if (live.length > 0) {
        const id = localStorage.getItem(activeKey(root)) ?? crypto.randomUUID();
        const entry: ArchivedChat = { id, root, title: titleOf(live), updatedAt: Date.now(), messages: lite(live) };
        list = [entry, ...list.filter((c) => c.id !== id)];
        localStorage.setItem(activeKey(root), id);
      }
    } else {
      // Archive the conversation of the project we are leaving, under that project.
      list = saveActive(get(), list);
    }
    writeChats(list);
    all = list;
    const forRoot = ofRoot(list, root);
    const savedActive = localStorage.getItem(activeKey(root));
    const active = forRoot.find((c) => c.id === savedActive) ?? forRoot[0] ?? null;
    set({ root, chats: forRoot, activeId: active?.id ?? null });
    useAi.setState({ messages: active ? active.messages : [], error: null });
    persistMessages(active ? active.messages : []);
  },
}));
