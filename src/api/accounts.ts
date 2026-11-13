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

export const accountsApi = {
  /** Looks through the local sign-in files of AI agents (read-only; nothing is sent anywhere). */
  scan: () => invoke<AgentAccount[]>("scan_agent_accounts"),
};
