import { invoke } from "@tauri-apps/api/core";

export interface FsEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export interface DeleteReport {
  done: string[];
  failed: string[];
}

export interface SearchMatch {
  path: string;
  line: number;
  column: number;
  text: string;
}

export const fs = {
  openWorkspace: (path: string) => invoke<void>("open_workspace", { path }),
  listDir: (path: string) => invoke<FsEntry[]>("list_dir", { path }),
  readFile: (path: string) => invoke<string>("read_file", { path }),
  writeFile: (path: string, content: string) =>
    invoke<void>("write_file", { path, content }),
  createEntry: (path: string, isDir: boolean) =>
    invoke<void>("create_entry", { path, isDir }),
  deleteEntry: (path: string) => invoke<void>("delete_entry", { path }),
  /** Delete: to the Recycle Bin (Windows). Several items at once; nested ones are collapsed on the Rust side. */
  trashEntries: (paths: string[]) => invoke<DeleteReport>("trash_entries", { paths }),
  /** Shift+Delete: gone for good. */
  deleteEntries: (paths: string[]) => invoke<DeleteReport>("delete_entries", { paths }),
  renameEntry: (path: string, newName: string) =>
    invoke<void>("rename_entry", { path, newName }),
  searchProject: (query: string, caseSensitive: boolean, wholeWord: boolean) =>
    invoke<SearchMatch[]>("search_project", { query, caseSensitive, wholeWord }),
};
