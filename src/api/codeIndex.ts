import { invoke } from "@tauri-apps/api/core";

export interface IndexStatus {
  files: number;
  lines: number;
  symbols: number;
  chunks: number;
  terms: number;
  /** The project is bigger than the index limit: part of the files is left out. */
  truncated: boolean;
  buildMs: number;
  /** Unix time in ms of the last change of the index; 0 if it has not been built. */
  updatedAt: number;
  languages: [string, number][];
}

export interface SearchHit {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  symbols: string[];
  snippet: string;
}

export interface SymbolHit {
  path: string;
  name: string;
  kind: string;
  line: number;
  container: string | null;
  signature: string;
}

// The code index (src-tauri/src/code_index.rs): the same one the agent uses through search_code, find_symbol and project_map.
export const codeIndexApi = {
  status: () => invoke<IndexStatus>("code_index_status"),
  rebuild: () => invoke<IndexStatus>("code_index_rebuild"),
  search: (query: string, limit?: number) => invoke<SearchHit[]>("code_index_search", { query, limit }),
  symbols: (query: string, limit?: number) => invoke<SymbolHit[]>("code_index_symbols", { query, limit }),
};
