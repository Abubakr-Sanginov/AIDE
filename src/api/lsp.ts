import { invoke } from "@tauri-apps/api/core";

export interface LspServerInfo {
  id: string;
  name: string;
  /** Resolved program path, or null when the server is not installed. */
  command: string | null;
  install: string;
  extensions: string[];
  running: boolean;
}

export interface LspFileServer {
  server: string;
  languageId: string;
  uri: string;
  available: boolean;
  install: string;
}

export const lspApi = {
  servers: () => invoke<LspServerInfo[]>("lsp_servers"),
  forPath: (path: string) => invoke<LspFileServer | null>("lsp_for_path", { path }),
  pathForUri: (uri: string) => invoke<string | null>("lsp_path_for_uri", { uri }),
  start: (server: string) => invoke<void>("lsp_start", { server }),
  send: (server: string, message: string) => invoke<void>("lsp_send", { server, message }),
  stop: (server: string) => invoke<void>("lsp_stop", { server }),
};
