import { invoke } from "@tauri-apps/api/core";

/** What AIDE knows about Qoder on this computer. The token itself never comes back to the window. */
export interface QoderStatus {
  /** Path of the official Qoder CLI, or null when it is not installed. */
  cli: string | null;
  /** The Qoder desktop app is installed. */
  desktop: boolean;
  /** A personal access token is saved in AIDE. */
  token_saved: boolean;
  /** A personal access token is set in the environment (QODER_PERSONAL_ACCESS_TOKEN). */
  token_env: boolean;
}

export const qoderApi = {
  status: () => invoke<QoderStatus>("qoder_status"),
  /** Stores a personal access token the user created for other tools (Windows credential store). */
  setToken: (token: string) => invoke<void>("qoder_set_token", { token }),
  clearToken: () => invoke<void>("qoder_clear_token"),
};
