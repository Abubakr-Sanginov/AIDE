import { invoke } from "@tauri-apps/api/core";
import type { LocalModelInfo, LocalServerId } from "@/lib/localProviders";

export interface LocalServerStatus {
  id: LocalServerId;
  name: string;
  baseUrl: string;
  running: boolean;
  version: string | null;
  models: LocalModelInfo[];
  error: string | null;
}

export const localApi = {
  /** Asks this computer's Ollama and LM Studio (loopback addresses only) which models they have. */
  probe: (targets: { id: LocalServerId; baseUrl: string }[]) => invoke<LocalServerStatus[]>("local_probe", { targets }),
  /** Creates an Ollama model "<name>-aide-16k" sharing the weights, with a bigger context. Returns its name. */
  createVariant: (baseUrl: string, model: string, numCtx?: number) =>
    invoke<string>("local_ollama_variant", { baseUrl, model, numCtx: numCtx ?? null }),
  /** Removes a model that AIDE created (name ends in -aide-<N>k); the Rust side refuses anything else. */
  deleteVariant: (baseUrl: string, model: string) => invoke<void>("local_ollama_delete_variant", { baseUrl, model }),
};
