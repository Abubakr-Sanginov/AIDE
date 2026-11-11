import { create } from "zustand";
import {
  EMPTY_DRAFT,
  LIMITS,
  SAMPLE_SNIPPETS,
  sanitizeStored,
  toStored,
  type Snippet,
  type SnippetDraft,
} from "@/features/snippets/model";

// User snippets live in localStorage (`aide.*` keys are mirrored to disk by lib/persist).
const KEY = "aide.snippets.v1";
// Written by the first version of the panel; read once and migrated to KEY.
const LEGACY_KEY = "aide.snippets";

function load(): Snippet[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) return sanitizeStored(JSON.parse(raw));
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy === null) return [];
    const list = sanitizeStored(JSON.parse(legacy));
    persist(list);
    localStorage.removeItem(LEGACY_KEY);
    return list;
  } catch {
    return [];
  }
}

function persist(list: Snippet[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(toStored(list)));
  } catch {
    /* storage full or unavailable: the list stays in memory */
  }
}

export interface SnippetEditing {
  /** null = new snippet. */
  id: string | null;
  draft: SnippetDraft;
  nonce: number;
}

interface SnippetsState {
  snippets: Snippet[];
  editing: SnippetEditing | null;
  startEdit: (id: string | null, draft?: Partial<SnippetDraft>) => void;
  cancelEdit: () => void;
  /** Returns "errLimit" when a new snippet does not fit. */
  save: (value: Omit<Snippet, "id">) => "errLimit" | null;
  remove: (id: string) => void;
  addSamples: () => void;
}

export const useSnippets = create<SnippetsState>((set, get) => ({
  snippets: load(),
  editing: null,
  startEdit: (id, draft) =>
    set({ editing: { id, draft: { ...EMPTY_DRAFT, ...draft }, nonce: Date.now() } }),
  cancelEdit: () => set({ editing: null }),
  save: (value) => {
    const { snippets, editing } = get();
    let next: Snippet[];
    if (editing?.id && snippets.some((s) => s.id === editing.id)) {
      next = snippets.map((s) => (s.id === editing.id ? { id: s.id, ...value } : s));
    } else {
      if (snippets.length >= LIMITS.count) return "errLimit";
      next = [...snippets, { id: crypto.randomUUID(), ...value }];
    }
    persist(next);
    set({ snippets: next, editing: null });
    return null;
  },
  remove: (id) => {
    const next = get().snippets.filter((s) => s.id !== id);
    persist(next);
    set((s) => ({ snippets: next, editing: s.editing?.id === id ? null : s.editing }));
  },
  addSamples: () => {
    const { snippets } = get();
    const have = new Set(snippets.map((s) => s.prefix + "|" + s.langs.join(",")));
    const extra = SAMPLE_SNIPPETS.filter((s) => !have.has(s.prefix + "|" + s.langs.join(","))).map((s) => ({
      id: crypto.randomUUID(),
      ...s,
    }));
    const next = [...snippets, ...extra].slice(0, LIMITS.count);
    persist(next);
    set({ snippets: next });
  },
}));
