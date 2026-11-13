import { invoke } from "@tauri-apps/api/core";

/** An AI agent found on this computer. Secrets are never part of it: only plan, a masked account and harmless facts. */
export interface AgentAccount {
  id: string;
  name: string;
  /** In AIDE's list of agents (false = found by the general search). */
  known: boolean;
  location: string;
  plan: string | null;
  /** Account; an e-mail address is masked ("ab***@mail.com"). */
  account: string | null;
  /** Unix time, ms: when the sign-in token expires, if the files say so. */
  expires_at: number | null;
  facts: [string, string][];
  signed_in: boolean;
}

/** A key or token an agent stored. Only a description: the value itself never leaves the backend. */
export interface KeyCandidate {
  id: string;
  file: string;
  field: string;
  /** First characters and length, enough to recognise the key. */
  preview: string;
  kind: "openai" | "anthropic" | "google";
  base_url: string | null;
  /** Why it cannot be used (null = it can). */
  blocked: string | null;
}

/** Agents whose sign-in only works inside their own app. */
export const BLOCKED_AGENTS = ["claude-code", "codex", "gemini"];

export const accountsApi = {
  /** Keys found in an agent's files (not for Claude Code, Codex and Gemini CLI). */
  keys: (agentId: string) => invoke<KeyCandidate[]>("list_agent_keys", { agentId }),
  /** The backend reads the chosen key and puts it into the Windows credential store under `providerId` ("agent-…"). */
  importKey: (candidateId: string, providerId: string) => invoke<void>("import_agent_key", { candidateId, providerId }),
  /** Models the agent wrote next to the chosen key (for servers that do not list models). Never includes the key. */
  models: (candidateId: string) => invoke<string[]>("list_agent_models", { candidateId }),
  /** Looks through the local sign-in files of AI agents (read-only; nothing is sent anywhere). */
  scan: () => invoke<AgentAccount[]>("scan_agent_accounts"),
};
