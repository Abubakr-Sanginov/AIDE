import { create } from "zustand";
import { providerSlug, validateCustomProvider } from "@/lib/customProvider";
import {
  LOCAL_DEFAULTS,
  LOCAL_URLS_KEY,
  isLocalProvider,
  isLoopbackUrl,
  normalizeLocalUrl,
  parseLocalUrls,
  type LocalServerId,
} from "@/lib/localProviders";
import { modelSelection, normalizeModelId } from "@/lib/modelSelection";
import { CONTINUE_REQUEST, resumeContent } from "@/lib/agentResume";
import { filterAssistantChunk, stripToolCallEcho, visibleAssistantOutput, type OutputFilterState } from "@/lib/assistantOutput";
import {
  ai,
  chatHistory,
  cliTools,
  onAiChunk,
  onAiThinking,
  onAiRetry,
  onAiDone,
  onAiError,
  onAiTool,
  type AgentMode,
  type PermissionMode,
  type ProviderConfig,
  type Attachment,
  type TokenUsage,
} from "@/api/ai";
import { useTabs } from "@/stores/tabs";
import { currentRoot, keyFor, projectScope, sameRoot } from "@/lib/workspaceKey";
import { t } from "@/i18n/t";
import { usePermissionGate } from "@/features/chat/PermissionGate";
import { agentNotice } from "@/lib/notify";

export type AiMode = "chat" | AgentMode;

export const MAX_ATTACH_SIZE = 8 * 1024 * 1024;
export const MAX_ATTACH_TOTAL = 20 * 1024 * 1024;
export const MAX_ATTACH_FILES = 20;

export interface AttachResult {
  added: number;
  skipped: { name: string; reason: "size" | "total" | "count" | "read" }[];
}

export interface ToolEvent {
  tool: string;
  args: string;
  status: "running" | "ok" | "error" | "denied";
  result: string;
  iteration: number;
}

export const BUILTIN_PROVIDERS: ProviderConfig[] = [
  { id: "openai", name: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1" },
  { id: "anthropic", name: "Anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com" },
  { id: "codex", name: "Codex (OpenAI)", kind: "openai", baseUrl: "https://api.openai.com/v1" },
  { id: "openrouter", name: "OpenRouter", kind: "openai", baseUrl: "https://openrouter.ai/api/v1" },
  {
    id: "google",
    name: "Google Gemini",
    kind: "google",
    baseUrl: "https://generativelanguage.googleapis.com",
  },
  { id: "groq", name: "Groq", kind: "openai", baseUrl: "https://api.groq.com/openai/v1" },
  { id: "deepseek", name: "DeepSeek", kind: "openai", baseUrl: "https://api.deepseek.com/v1" },
  { id: "mistral", name: "Mistral", kind: "openai", baseUrl: "https://api.mistral.ai/v1" },
  { id: "xai", name: "xAI (Grok)", kind: "openai", baseUrl: "https://api.x.ai/v1" },
  { id: "together", name: "Together AI", kind: "openai", baseUrl: "https://api.together.xyz/v1" },
  // On this computer, no key. The address can be changed in Settings (another port).
  { id: "ollama", name: "Ollama", kind: "openai", baseUrl: LOCAL_DEFAULTS.ollama },
  { id: "lmstudio", name: "LM Studio", kind: "openai", baseUrl: LOCAL_DEFAULTS.lmstudio },
];

/** Built-in providers with the user's saved address for local servers (a non-default port). */
function withLocalUrls(list: ProviderConfig[]): ProviderConfig[] {
  let urls: ReturnType<typeof parseLocalUrls> = {};
  try {
    urls = parseLocalUrls(localStorage.getItem(LOCAL_URLS_KEY));
  } catch {
    /* storage unavailable: defaults */
  }
  return list.map((p) => (p.id === "ollama" || p.id === "lmstudio") && urls[p.id] ? { ...p, baseUrl: urls[p.id] as string } : p);
}

const CUSTOM_KEY = "aide.customProviders";
const KEY_PROVIDER = "aide.provider";
const KEY_ATTACH = "aide.attachFile";
const KEY_MODE = "aide.mode";
const KEY_AUTH_PREFIX = "aide.auth.";

export function authOf(providerId: string): "key" | "bearer" {
  return localStorage.getItem(KEY_AUTH_PREFIX + providerId) === "bearer" ? "bearer" : "key";
}

const OPENCODE_UA = "opencode/1.18.5";

export function uaOf(providerId: string): string | undefined {
  return providerId === "opencode" ? OPENCODE_UA : undefined;
}

const ANTHROPIC_FALLBACK_MODELS = [
  "claude-opus-4-1",
  "claude-sonnet-4-5",
  "claude-3-7-sonnet-latest",
  "claude-3-5-haiku-latest",
];

function loadCustomProviders(): ProviderConfig[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveCustomProviders(list: ProviderConfig[]) {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  error?: boolean;
  errorText?: string;
  retryStatus?: { attempt: number; max: number };
  tools?: ToolEvent[];
  iterations?: number;
  /** Tokens this answer cost; shown under it. */
  usage?: TokenUsage;
  attachments?: Attachment[];
}

interface AiState {
  providers: ProviderConfig[];
  providerId: string;
  hasKey: boolean;
  models: string[];
  model: string;
  modelsLoading: boolean;
  modelsError: string | null;
  attachFile: boolean;
  mode: AiMode;
  permissionMode: PermissionMode;
  /** Self-check after the agent's edits (typecheck, lint, tests). */
  autoCheck: boolean;
  setAutoCheck: (on: boolean) => void;
  /** Local models: shorter instructions and fewer tools for the agent, so small models cope. Default on. */
  localCompact: boolean;
  setLocalCompact: (on: boolean) => void;
  /** Change the address of Ollama / LM Studio (loopback addresses only). Returns an error key or null. */
  setLocalUrl: (id: LocalServerId, url: string) => "invalid" | null;
  /** Make a model of a local server the active one. */
  selectLocalModel: (providerId: string, model: string) => void;
  messages: ChatMessage[];
  attachments: Attachment[];
  streaming: boolean;
  streamingId: string | null;
  error: string | null;
  provider: () => ProviderConfig;
  setProvider: (providerId: string) => void;
  setModel: (model: string) => void;
  setAttachFile: (attach: boolean) => void;
  setMode: (mode: AiMode) => void;
  setPermissionMode: (mode: PermissionMode) => void;
  /** Adds files to the next message; reports the ones that could not be attached and why. */
  addFiles: (files: File[]) => Promise<AttachResult>;
  removeAttachment: (index: number) => void;
  clearAttachments: () => void;
  refreshKey: () => Promise<void>;
  importCliTools: () => Promise<import("@/api/ai").CliToolInfo[]>;
  useCliTool: (tool: import("@/api/ai").CliToolInfo) => Promise<void>;
  saveKey: (key: string) => Promise<void>;
  clearKey: () => Promise<void>;
  refreshModels: () => Promise<void>;
  testConnection: () => Promise<{ ok: boolean; message: string }>;
  addCustomProvider: (cfg: ProviderConfig, key: string) => Promise<void>;
  removeCustomProvider: (providerId: string) => void;
  send: (text: string) => Promise<void>;
  retry: () => Promise<void>;
  stop: () => void;
  clear: () => void;
  commit: (requestId: string, text: string) => void;
  thinkingEvent: (requestId: string, text: string) => void;
  done: (requestId: string, iterations?: number, usage?: TokenUsage) => void;
  fail: (requestId: string, message: string) => void;
  toolEvent: (requestId: string, event: ToolEvent) => void;
}

function modelKey(providerId: string) {
  return `aide.model.${providerId}`;
}

function buildContext(): string | null {
  const tabs = useTabs.getState();
  const active = tabs.tabs.find((t) => t.id === tabs.activeId);
  if (!active) return null;
  return `${t("inlineEdit.file")}: ${active.path}\n${t("inlineEdit.language")}: ${active.language}\n\n${active.content}`;
}

// Serializing the whole chat on every streamed chunk froze the UI once the history grew (every tool result is in it):
// the work is now done at most once per second, and right away when an answer ends.
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistLatest: ChatMessage[] | null = null;
function writeHistory() {
  persistTimer = null;
  const messages = persistLatest;
  persistLatest = null;
  if (!messages) return;
  const raw = JSON.stringify(messages);
  const root = currentRoot();
  try {
    localStorage.setItem(keyFor("aide.chatHistory", root), raw);
  } catch {
    /* quota exceeded: the copy on disk below is the one that counts */
  }
  void chatHistory.save(raw, projectScope(root));
}
export function persistMessages(messages: ChatMessage[]) {
  persistLatest = messages;
  if (!persistTimer) persistTimer = setTimeout(writeHistory, 1000);
}
export function flushPersist() {
  if (persistTimer) clearTimeout(persistTimer);
  writeHistory();
}

export function cleanAssistantMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => m.role === "assistant" && typeof m.content === "string"
    ? { ...m, content: visibleAssistantOutput(m.content) }
    : m);
}

function loadMessages(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(keyFor("aide.chatHistory", currentRoot()));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? cleanAssistantMessages(arr) : [];
  } catch {
    return [];
  }
}

export const useAi = create<AiState>((set, get) => ({
  providers: withLocalUrls([...BUILTIN_PROVIDERS, ...loadCustomProviders()]),
  // The former "Claude Code key" provider is gone: those users continue on the regular Anthropic one.
  providerId: ((v) => (v === "claude-code" ? "anthropic" : v || "openai"))(localStorage.getItem(KEY_PROVIDER)),
  hasKey: false,
  ...modelSelection([], localStorage.getItem(modelKey(localStorage.getItem(KEY_PROVIDER) === "claude-code" ? "anthropic" : localStorage.getItem(KEY_PROVIDER) || "openai"))),
  modelsLoading: false,
  modelsError: null,
  attachFile: localStorage.getItem(KEY_ATTACH) !== "0",
  mode: (localStorage.getItem(KEY_MODE) as AiMode) || "chat",
  permissionMode:
    (localStorage.getItem("aide.permissionMode") as PermissionMode) || "auto",
  autoCheck: localStorage.getItem("aide.autoCheck") !== "0",
  localCompact: localStorage.getItem("aide.localCompact") !== "0",
  messages: loadMessages(),
  attachments: [],
  streaming: false,
  streamingId: null,
  error: null,

  provider: () =>
    get().providers.find((p) => p.id === get().providerId) ?? BUILTIN_PROVIDERS[0],

  setProvider: (providerId) => {
    localStorage.setItem(KEY_PROVIDER, providerId);
    set({
      providerId,
      hasKey: isLocalProvider(providerId),
      ...modelSelection([], localStorage.getItem(modelKey(providerId))),
      modelsLoading: false,
      modelsError: null,
    });
    void get().refreshKey();
  },

  setModel: (model) => {
    const { providerId, models } = get();
    model = normalizeModelId(model);
    localStorage.setItem(modelKey(providerId), model);
    set(modelSelection(models, model));
  },

  setAttachFile: (attachFile) => {
    localStorage.setItem(KEY_ATTACH, attachFile ? "1" : "0");
    set({ attachFile });
  },

  setMode: (mode) => {
    localStorage.setItem(KEY_MODE, mode);
    set({ mode });
  },

  setLocalCompact: (localCompact) => {
    localStorage.setItem("aide.localCompact", localCompact ? "1" : "0");
    set({ localCompact });
  },
  setLocalUrl: (id, url) => {
    const normalized = normalizeLocalUrl(url);
    if (!normalized) return "invalid";
    let saved: Record<string, string> = {};
    try {
      saved = JSON.parse(localStorage.getItem(LOCAL_URLS_KEY) || "{}") as Record<string, string>;
    } catch {
      saved = {};
    }
    if (normalized === LOCAL_DEFAULTS[id]) delete saved[id];
    else saved[id] = normalized;
    localStorage.setItem(LOCAL_URLS_KEY, JSON.stringify(saved));
    set((s) => ({ providers: s.providers.map((p) => (p.id === id ? { ...p, baseUrl: normalized } : p)) }));
    if (get().providerId === id) void get().refreshModels();
    return null;
  },
  selectLocalModel: (providerId, model) => {
    const id = normalizeModelId(model);
    localStorage.setItem(KEY_PROVIDER, providerId);
    localStorage.setItem(modelKey(providerId), id);
    set({ providerId, hasKey: true, ...modelSelection([id], id), modelsLoading: false, modelsError: null });
    void get().refreshModels();
  },
  setAutoCheck: (autoCheck) => {
    localStorage.setItem("aide.autoCheck", autoCheck ? "1" : "0");
    set({ autoCheck });
  },
  setPermissionMode: (permissionMode) => {
    localStorage.setItem("aide.permissionMode", permissionMode);
    set({ permissionMode });
  },

  addFiles: async (files) => {
    const pending = [...get().attachments];
    const before = pending.length;
    let total = pending.reduce((sum, a) => sum + (a.size ?? 0), 0);
    const skipped: AttachResult["skipped"] = [];
    for (const file of files.slice(0, MAX_ATTACH_FILES * 2)) {
      const name = (file.name || "file").slice(0, 200);
      if (pending.length >= MAX_ATTACH_FILES) {
        skipped.push({ name, reason: "count" });
        continue;
      }
      if (file.size > MAX_ATTACH_SIZE) {
        skipped.push({ name, reason: "size" });
        continue;
      }
      if (total + file.size > MAX_ATTACH_TOTAL) {
        skipped.push({ name, reason: "total" });
        continue;
      }
      let data: string;
      try {
        data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.onerror = () => reject(new Error("read failed"));
          reader.readAsDataURL(file);
        });
      } catch {
        // A folder or a file that is locked / gone cannot be read.
        skipped.push({ name, reason: "read" });
        continue;
      }
      const comma = data.indexOf(",");
      pending.push({
        name,
        mime: file.type || "application/octet-stream",
        data: comma >= 0 ? data.slice(comma + 1) : data,
        size: file.size,
      });
      total += file.size;
    }
    set({ attachments: pending });
    return { added: pending.length - before, skipped };
  },

  removeAttachment: (index) => {
    set((s) => ({
      attachments: s.attachments.filter((_, i) => i !== index),
    }));
  },

  clearAttachments: () => set({ attachments: [] }),

  refreshKey: async () => {
    const { providerId } = get();
    // A model on this computer needs no key: it is ready as soon as it is chosen.
    if (isLocalProvider(providerId)) {
      set({ hasKey: true });
      void get().refreshModels();
      return;
    }
    try {
      const hasKey = await ai.hasApiKey(providerId);
      if (get().providerId !== providerId) return;
      set({ hasKey });
      if (hasKey) void get().refreshModels();
    } catch (e) {
      // Not "no key" but a real storage failure: show it instead of silently looking like an unsaved key.
      set({ hasKey: false, modelsError: String(e) });
    }
  },

  importCliTools: async () => {
    try {
      // Only detects: keys found in other tools' configs are copied into AIDE when the user presses "Use".
      const found = await cliTools.detect();
      return Array.isArray(found) ? found : [];
    } catch {
      return [];
    }
  },

  useCliTool: async (tool) => {
    if (!tool.api_key) return;
    const provId = tool.id;
    const builtin = BUILTIN_PROVIDERS.find((p) => p.id === provId);
    if (!builtin || (tool.base_url && builtin.baseUrl !== tool.base_url)) {
      const kind = tool.kind === "anthropic" ? "anthropic" : tool.kind === "google" ? "google" : "openai";
      const cfg: ProviderConfig = {
        id: provId,
        name: tool.name,
        kind,
        baseUrl: tool.base_url ?? builtin?.baseUrl ?? "https://api.openai.com/v1",
        custom: true,
      };
      const providers = [...get().providers.filter((p) => p.id !== provId), cfg];
      saveCustomProviders(providers.filter((p) => p.custom));
      set({ providers });
    }
    if (tool.auth === "bearer") {
      localStorage.setItem(KEY_AUTH_PREFIX + provId, "bearer");
    }
    if (tool.model) {
      localStorage.setItem(modelKey(provId), tool.model);
    }
    await ai.setApiKey(provId, tool.api_key);
    get().setProvider(provId);
  },

  saveKey: async (key) => {
    const { providerId } = get();
    if (!key.trim()) return;
    await ai.setApiKey(providerId, key.trim());
    set({ hasKey: true });
    void get().refreshModels();
  },

  clearKey: async () => {
    const { providerId } = get();
    await ai.deleteApiKey(providerId);
    set({ hasKey: false, models: [], model: "", modelsError: null });
  },

  refreshModels: async () => {
    if (!navigator.onLine) {
      set({ modelsLoading: false, modelsError: "offline" });
      return;
    }
    const cfg = get().provider();
    if (!get().hasKey) return;
    set({ modelsLoading: true, modelsError: null });
    try {
      const models = await ai.listModels(cfg.id, cfg.kind, cfg.baseUrl, authOf(cfg.id), uaOf(cfg.id));
      if (get().providerId !== cfg.id) return;
      const selection = modelSelection(models, localStorage.getItem(modelKey(cfg.id)));
      localStorage.setItem(modelKey(cfg.id), selection.model);
      set({ ...selection, modelsLoading: false });
    } catch (e) {
      if (get().providerId !== cfg.id) return;
      const fallback = cfg.kind === "anthropic" ? ANTHROPIC_FALLBACK_MODELS : [];
      const selection = modelSelection(fallback, localStorage.getItem(modelKey(cfg.id)));
      set({ ...selection, modelsLoading: false, modelsError: cfg.kind === "anthropic" ? null : String(e) });
    }
  },

  testConnection: async () => {
    const cfg = get().provider();
    try {
      const models = await ai.listModels(cfg.id, cfg.kind, cfg.baseUrl, authOf(cfg.id), uaOf(cfg.id));
      const auth =
        authOf(cfg.id) === "bearer"
          ? "Bearer"
          : cfg.kind === "anthropic"
            ? "x-api-key"
            : cfg.kind === "google"
              ? "query key"
              : "Bearer";
      return {
        ok: true,
        message: t("settings.testOk", {
          count: String(models.length),
          model: models[0] ?? "—",
          auth,
        }),
      };
    } catch (e) {
      return { ok: false, message: t("settings.testFail", { error: String(e) }) };
    }
  },

  addCustomProvider: async (cfg, key) => {
    // A server on this computer without a key (llama.cpp, vLLM, …) is a local provider: its id gets the "local-" prefix.
    if (!key.trim() && isLoopbackUrl(cfg.baseUrl) && !isLocalProvider(cfg.id.trim())) {
      cfg = { ...cfg, id: `local-${cfg.id.trim() || providerSlug(cfg.name)}`.slice(0, 40) };
    }
    cfg = { ...validateCustomProvider(cfg, get().providers), custom: true };
    // Do not publish a half-added provider if secure key storage fails.
    if (key.trim()) await ai.setApiKey(cfg.id, key.trim());
    const providers = [...get().providers, cfg];
    saveCustomProviders(providers.filter((p) => p.custom));
    localStorage.setItem(KEY_PROVIDER, cfg.id);
    const ready = Boolean(key.trim()) || isLocalProvider(cfg.id);
    set({ providers, providerId: cfg.id, hasKey: ready, models: [], model: "", modelsError: null });
    if (ready) void get().refreshModels();
  },

  removeCustomProvider: (providerId) => {
    const providers = get().providers.filter((p) => p.id !== providerId);
    saveCustomProviders(providers.filter((p) => p.custom));
    set({ providers });
    void ai.deleteApiKey(providerId).catch(() => {});
    if (get().providerId === providerId) {
      get().setProvider("openai");
    }
  },

  send: async (text) => {
    const s = get();
    const trimmed = text.trim();
    if (!trimmed || s.streaming) return;
    if (!navigator.onLine) {
      set({ error: t("chat.offline") });
      return;
    }
    if (!s.hasKey) {
      set({ error: t("inlineEdit.noKey") });
      return;
    }
    if (!s.model) {
      set({
        error: t("inlineEdit.noModels"),
      });
      return;
    }
    const cfg = s.provider();
    const requestId = crypto.randomUUID();
    const atts = s.attachments.length > 0 ? [...s.attachments] : undefined;
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      attachments: atts,
    };
    const asstMsg: ChatMessage = { id: requestId, role: "assistant", content: "" };
    set({
      messages: [...s.messages, userMsg, asstMsg],
      attachments: [],
      streaming: true,
      streamingId: requestId,
      error: null,
    });
    persistMessages([...get().messages]);
    const context = s.attachFile ? buildContext() : null;
    const history = get()
      .messages.slice(0, -2)
      .filter((m) => !m.error || !!m.content || !!m.thinking || !!m.tools?.length)
      .map((m) => ({
        role: m.role,
        content: s.mode === "chat" ? m.content : resumeContent(m),
        reasoningContent: m.role === "assistant" ? m.thinking || "" : undefined,
        ...(m.attachments && m.attachments.length > 0
          ? { attachments: m.attachments }
          : {}),
      }));
    try {
      if (s.mode === "chat") {
        await ai.chat({
          requestId,
          providerId: cfg.id,
          kind: cfg.kind,
          baseUrl: cfg.baseUrl,
          model: s.model,
          messages: [
            ...history,
            { role: "user", content: trimmed, attachments: atts },
          ],
          context,
          auth: authOf(cfg.id),
          userAgent: uaOf(cfg.id),
        });
      } else {
        await ai.agentChat({
          requestId,
          providerId: cfg.id,
          kind: cfg.kind,
          baseUrl: cfg.baseUrl,
          model: s.model,
          mode: s.mode,
          instruction: trimmed,
          history,
          permissionMode: s.permissionMode,
          autoCheck: s.autoCheck,
          compact: isLocalProvider(cfg.id) ? s.localCompact : undefined,
          attachments: atts,
          context,
          auth: authOf(cfg.id),
          userAgent: uaOf(cfg.id),
        });
      }
    } catch (e) {
      get().fail(requestId, String(e));
    }
  },

  retry: async () => {
    const s = get();
    const lastUser = [...s.messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    if (s.streaming) return;
    // Preserve partial answers in every mode, not just agent mode.
    await get().send(CONTINUE_REQUEST);
  },

  stop: () => {
    const id = get().streamingId;
    if (!id) return;
    // The backend drops the connection to the provider (so generation stops there too). The window does
    // not wait for that: the answer written so far stays, running steps are marked stopped, input unlocks.
    void ai.cancelChat(id).catch(() => {});
    usePermissionGate.getState().forget(id);
    outputFilters.delete(id);
    set((s) => ({
      streaming: false,
      streamingId: null,
      error: null,
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, tools: m.tools?.map((x) => (x.status === "running" ? { ...x, status: "error" as const, result: "stopped" } : x)) } : m,
      ),
    }));
    persistMessages(get().messages);
  },

  clear: () => {
    if (get().streamingId) outputFilters.delete(get().streamingId!);
    set({ messages: [], streaming: false, streamingId: null, error: null });
    persistMessages([]);
  },

  commit: (requestId, text) => {
    if (get().streamingId !== requestId) return;
    if (!text) return;
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === requestId ? { ...m, content: m.content + text, retryStatus: undefined } : m,
      ),
    }));
    persistMessages(get().messages);
  },

  thinkingEvent: (requestId, text) => {
    if (get().streamingId !== requestId) return;
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === requestId ? { ...m, thinking: (m.thinking ?? "") + text, retryStatus: undefined } : m,
      ),
    }));
  },

  done: (requestId, iterations, usage) => {
    if (get().streamingId !== requestId) return;
    set((s) => ({
      streaming: false,
      streamingId: null,
      error: null,
      messages: s.messages.map((m) =>
        m.id === requestId ? { ...m, content: stripToolCallEcho(m.content), iterations, usage, retryStatus: undefined } : m,
      ),
    }));
    persistMessages(get().messages);
    const last = get().messages.find((m) => m.id === requestId);
    const snippet = (last?.content ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
    agentNotice(
      "done",
      snippet ||
        (get().mode === "agent"
          ? "Работа агента завершена"
          : get().mode === "plan"
            ? "План готов"
            : "Ответ готов"),
    );
  },

  fail: (requestId, message) => {
    if (get().streamingId !== requestId) return;
    const canceled = message === "canceled";
    set((s) => ({
      streaming: false,
      streamingId: null,
      error: canceled ? null : message,
      messages: s.messages.map((m) =>
        m.id === requestId
          ? {
              ...m,
              error: canceled ? false : true,
              errorText: canceled ? undefined : message,
              retryStatus: undefined,
            }
          : m,
      ),
    }));
    persistMessages(get().messages);
    if (!canceled) agentNotice("error", message);
  },

  toolEvent: (requestId, event) => {
    if (get().streamingId !== requestId) return;
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id !== requestId) return m;
        const tools = m.tools ?? [];
        const last = tools[tools.length - 1];
        if (last && last.tool === event.tool && last.args === event.args) {
          return { ...m, tools: [...tools.slice(0, -1), event] };
        }
        return { ...m, tools: [...tools, event], retryStatus: undefined };
      }),
    }));
    persistMessages(get().messages);
  },
}));

const outputFilters = new Map<string, OutputFilterState>();
let eventsInited = false;
export function ensureAiEvents() {
  if (eventsInited) return;
  eventsInited = true;
  // Streamed text is applied in batches (every ~50 ms) instead of one store update and re-render per token.
  const buf = new Map<string, { text: string; think: string }>();
  let bufTimer: ReturnType<typeof setTimeout> | null = null;
  const flushStream = () => {
    if (bufTimer) clearTimeout(bufTimer);
    bufTimer = null;
    const items = [...buf.entries()];
    buf.clear();
    for (const [id, b] of items) {
      if (b.think) useAi.getState().thinkingEvent(id, b.think);
      if (b.text) useAi.getState().commit(id, b.text);
    }
  };
  const queue = (id: string, key: "text" | "think", text: string) => {
    const b = buf.get(id) ?? { text: "", think: "" };
    b[key] += text;
    buf.set(id, b);
    if (!bufTimer) bufTimer = setTimeout(flushStream, 50);
  };
  onAiChunk((e) => {
    // Do not collect an unlimited leaked suffix in the event queue or render it.
    if (useAi.getState().streamingId !== e.request_id) return;
    let filter = outputFilters.get(e.request_id);
    if (!filter) {
      filter = { pending: "", blocked: false };
      outputFilters.set(e.request_id, filter);
    }
    const visible = filterAssistantChunk(filter, e.text);
    if (visible) queue(e.request_id, "text", visible);
  });
  onAiRetry((e) => {
    if (useAi.getState().streamingId !== e.request_id) return;
    flushStream();
    useAi.setState((s) => ({ messages: s.messages.map((m) => m.id === e.request_id
      ? { ...m, retryStatus: { attempt: e.attempt, max: e.max_retries } } : m) }));
  });
  onAiThinking((e) => queue(e.request_id, "think", e.text));
  onAiDone((e) => {
    const filter = outputFilters.get(e.request_id);
    if (filter?.pending) queue(e.request_id, "text", filter.pending);
    outputFilters.delete(e.request_id);
    flushStream();
    useAi.getState().done(e.request_id, e.iterations, e.usage);
    flushPersist();
  });
  onAiError((e) => {
    const filter = outputFilters.get(e.request_id);
    if (filter?.pending) queue(e.request_id, "text", filter.pending);
    outputFilters.delete(e.request_id);
    flushStream();
    useAi.getState().fail(e.request_id, e.message);
    flushPersist();
  });
  onAiTool((e) => {
    flushStream();
    useAi.getState().toolEvent(e.request_id, {
      tool: e.tool,
      args: e.args,
      status: e.status as ToolEvent["status"],
      result: e.result,
      iteration: e.iteration,
    });
  });
  loadHistoryFromDisk();
}

/**
 * История живого чата принадлежит проекту: у каждого свой файл на диске и свой
 * ключ в localStorage. Вызывается при старте и при переключении проекта — так
 * в новый проект не подтягивается переписка из предыдущего.
 */
let historyRoot: string | null | undefined;
export function loadHistoryFromDisk(force = false) {
  const root = currentRoot();
  if (!force && historyRoot !== undefined && sameRoot(historyRoot, root)) return;
  historyRoot = root;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
  persistLatest = null;
  useAi.setState({ messages: loadMessages() });
  void chatHistory.load(projectScope(root)).then((raw) => {
    try {
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return;
      // Пока читали файл, могли переключить проект — тогда эти данные уже чужие.
      if (!sameRoot(historyRoot, currentRoot())) return;
      const cleaned = cleanAssistantMessages(arr);
      useAi.setState({ messages: cleaned });
      if (cleaned.some((m, i) => m.content !== arr[i]?.content)) persistMessages(cleaned);
      else localStorage.setItem(keyFor("aide.chatHistory", root), raw);
    } catch {}
  });
}