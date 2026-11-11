import { create } from "zustand";
import { ai, onAiChunk, onAiDone, onAiError } from "@/api/ai";
import { useAi, authOf, uaOf } from "@/stores/ai";
import { useTabs } from "@/stores/tabs";
import { t } from "@/i18n/t";

export type InlineStatus = "input" | "streaming" | "done" | "error";

interface InlineEditState {
  tabId: string | null;
  from: number;
  to: number;
  original: string;
  instruction: string;
  status: InlineStatus;
  replacement: string;
  error: string | null;
  requestId: string | null;
  open: (tabId: string, from: number, to: number, original: string) => void;
  submit: (instruction: string) => void;
  cancel: () => void;
  retry: () => void;
  close: () => void;
  commit: (requestId: string, text: string) => void;
  done: (requestId: string) => void;
  fail: (requestId: string, message: string) => void;
}

function stripFences(text: string): string {
  const trimmed = text.trim();
  const m = trimmed.match(/^```[a-zA-Z0-9+#._-]*\s*\n?([\s\S]*?)\n?```$/);
  return m ? m[1] : text;
}

function buildContext(): string | null {
  const tabs = useTabs.getState();
  const active = tabs.tabs.find((t) => t.id === tabs.activeId);
  if (!active) return null;
  return `${t("inlineEdit.file")}: ${active.path}\n${t("inlineEdit.language")}: ${active.language}\n\n${active.content}`;
}

function buildUserMessage(instruction: string, original: string): string {
  return [
    t("inlineEdit.instruction", { instruction }),
    "",
    t("inlineEdit.selectedCode"),
    "```",
    original,
    "```",
    "",
    t("inlineEdit.returnOnly"),
  ].join("\n");
}

export const useInlineEdit = create<InlineEditState>((set, get) => ({
  tabId: null,
  from: 0,
  to: 0,
  original: "",
  instruction: "",
  status: "input",
  replacement: "",
  error: null,
  requestId: null,

  open: (tabId, from, to, original) =>
    set({ tabId, from, to, original, status: "input", replacement: "", error: null, requestId: null }),

  submit: (instruction) => {
    const s = get();
    if (!instruction.trim() || s.status === "streaming") return;
    const aiState = useAi.getState();
    if (!aiState.hasKey) {
      set({ status: "error", error: t("inlineEdit.noKey") });
      return;
    }
    if (!aiState.model) {
      set({ status: "error", error: t("inlineEdit.noModels") });
      return;
    }
    const requestId = crypto.randomUUID();
    set({
      instruction,
      status: "streaming",
      replacement: "",
      error: null,
      requestId,
    });
    void ai
      .chat({
        requestId,
        providerId: aiState.provider().id,
        kind: aiState.provider().kind,
        baseUrl: aiState.provider().baseUrl,
        model: aiState.model,
        messages: [
          {
            role: "user",
            content: buildUserMessage(instruction, s.original),
          },
        ],
        context: buildContext(),
        auth: authOf(aiState.provider().id),
        userAgent: uaOf(aiState.provider().id),
      })
      .catch((e) => get().fail(requestId, String(e)));
  },

  cancel: () => {
    const id = get().requestId;
    if (id) void ai.cancelChat(id);
  },

  retry: () => get().submit(get().instruction),

  close: () =>
    set({
      tabId: null,
      status: "input",
      replacement: "",
      error: null,
      requestId: null,
    }),

  commit: (requestId, text) => {
    if (get().requestId !== requestId) return;
    set((s) => ({ replacement: s.replacement + text }));
  },

  done: (requestId) => {
    if (get().requestId !== requestId) return;
    set((s) => ({ status: "done", replacement: stripFences(s.replacement) }));
  },

  fail: (requestId, message) => {
    if (get().requestId !== requestId) return;
    if (message === "canceled") {
      get().close();
      return;
    }
    set({ status: "error", error: message });
  },
}));

let eventsInited = false;
export function ensureInlineEditEvents() {
  if (eventsInited) return;
  eventsInited = true;
  onAiChunk((e) => useInlineEdit.getState().commit(e.request_id, e.text));
  onAiDone((e) => useInlineEdit.getState().done(e.request_id));
  onAiError((e) => useInlineEdit.getState().fail(e.request_id, e.message));
}