import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type ProviderKind = "openai" | "anthropic" | "google";

export interface ProviderConfig {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  custom?: boolean;
}

export interface Attachment {
  name: string;
  mime: string;
  data: string;
  size?: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  reasoningContent?: string;
  attachments?: Attachment[];
}

export interface ChatRequest {
  requestId: string;
  providerId: string;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  context: string | null;
  /** Replaces the IDE's default system prompt (used by the Design section). */
  system?: string;
  /** Output token limit (used by Anthropic, which requires one). */
  maxTokens?: number;
  auth?: "key" | "bearer";
  userAgent?: string;
}

export interface AiChunkEvent {
  request_id: string;
  text: string;
}

export interface AiThinkingEvent {
  request_id: string;
  text: string;
}

/** Tokens spent by one request (all steps of an agent run together). */
export interface TokenUsage {
  input: number;
  output: number;
  /** Part of the input that came from the provider's prompt cache. */
  cached: number;
}

export interface AiDoneEvent {
  request_id: string;
  iterations?: number;
  usage?: TokenUsage;
}

export interface AiRetryEvent {
  request_id: string;
  attempt: number;
  max_retries: number;
}

export interface AiErrorEvent {
  request_id: string;
  message: string;
}

export type AgentMode = "plan" | "agent" | "computer";

export type PermissionMode = "ask" | "auto" | "full";

export interface AgentRequest {
  requestId: string;
  providerId: string;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  mode: AgentMode;
  instruction: string;
  history?: ChatMessage[];
  permissionMode?: PermissionMode;
  attachments?: Attachment[];
  context: string | null;
  /** Replaces the default system prompt if provided. */
  system?: string;
  auth?: "key" | "bearer";
  userAgent?: string;
  /** Self-check after edits: run the project's typecheck/lint/tests and let the agent fix failures. Default on. */
  autoCheck?: boolean;
  /** Compact agent for small models (short instructions, core tools only). Default: on for local providers. */
  compact?: boolean;
}

export interface AiToolEvent {
  request_id: string;
  tool: string;
  args: string;
  status: string;
  result: string;
  iteration: number;
}

export interface AiPermissionEvent {
  request_id: string;
  tool: string;
  args: string;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionItem {
  question: string;
  header?: string;
  options?: QuestionOption[];
  multiple?: boolean;
  allow_custom?: boolean;
}

export interface AiQuestionEvent {
  request_id: string;
  questions: QuestionItem[];
}

export interface QuestionAnswer {
  questionId: string;
  answer: string;
}

export const ai = {
  chat: (request: ChatRequest) => invoke<void>("chat", { request }),
  agentChat: (request: AgentRequest) => invoke<void>("agent_chat", { request }),
  listModels: (
    providerId: string,
    kind: ProviderKind,
    baseUrl: string,
    auth?: "key" | "bearer",
    userAgent?: string,
  ) => invoke<string[]>("list_models", { providerId, kind, baseUrl, auth, userAgent }),
  cancelChat: (requestId: string) => invoke<void>("cancel_chat", { requestId }),
  respondPermission: (requestId: string, allow: boolean) =>
    invoke<void>("respond_permission", { requestId, allow }),
  respondQuestion: (requestId: string, answers: QuestionAnswer[]) =>
    invoke<void>("respond_question", { requestId, answers }),
  setApiKey: (providerId: string, key: string) =>
    invoke<void>("set_api_key", { providerId, key }),
  hasApiKey: (providerId: string) =>
    invoke<boolean>("get_api_key", { providerId }).then((k) => Boolean(k)),
  deleteApiKey: (providerId: string) => invoke<void>("delete_api_key", { providerId }),
};

function subscribe<T>(event: string, cb: (payload: T) => void): () => void {
  let unlisten: (() => void) | undefined;
  void listen<T>(event, (e) => cb(e.payload)).then((fn) => (unlisten = fn));
  return () => unlisten?.();
}

export const onAiRetry = (cb: (e: AiRetryEvent) => void) => subscribe<AiRetryEvent>("ai-retry", cb);
export const onAiChunk = (cb: (e: AiChunkEvent) => void) => subscribe<AiChunkEvent>("ai-chunk", cb);
export const onAiThinking = (cb: (e: AiThinkingEvent) => void) => subscribe<AiThinkingEvent>("ai-thinking", cb);
export const onAiDone = (cb: (e: AiDoneEvent) => void) => subscribe<AiDoneEvent>("ai-done", cb);
export const onAiError = (cb: (e: AiErrorEvent) => void) =>
  subscribe<AiErrorEvent>("ai-error", cb);
export const onAiTool = (cb: (e: AiToolEvent) => void) => subscribe<AiToolEvent>("ai-tool", cb);
export const onAiPermission = (cb: (e: AiPermissionEvent) => void) =>
  subscribe<AiPermissionEvent>("ai-permission", cb);
export const onAiQuestion = (cb: (e: AiQuestionEvent) => void) =>
  subscribe<AiQuestionEvent>("ai-question", cb);

// `scope` is the short hash of the project root (see src/lib/workspaceKey.ts): each
// project keeps its own history file on disk. Without a project the base file is used.
export const chatHistory = {
  save: (messages: string, scope?: string | null) =>
    invoke<void>("save_chat_history", { messages, scope: scope ?? null }),
  load: (scope?: string | null) => invoke<string>("load_chat_history", { scope: scope ?? null }),
};

export interface CliToolInfo {
  id: string;
  name: string;
  kind: string;
  api_key: string | null;
  base_url: string | null;
  auth: string;
  model: string | null;
}

export const cliTools = {
  detect: () => invoke<CliToolInfo[]>("detect_cli_tools"),
};