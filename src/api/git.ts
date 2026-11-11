import { invoke } from "@tauri-apps/api/core";

// Tauri commands from src-tauri/src/git_service.rs. Paths are relative to the repo root (`/`).

export interface GitFile {
  path: string;
  orig_path: string | null;
  /** X from porcelain: " ", M, A, D, R, C, U, ? */
  index: string;
  /** Y from porcelain. */
  worktree: string;
}

export interface GitStatus {
  /** Absolute path of the repository root. */
  top: string;
  branch: string | null;
  ahead: number;
  behind: number;
  files: GitFile[];
  truncated: boolean;
}

export interface GitDiff {
  path: string;
  original: string;
  modified: string;
}

export interface GitLogEntry {
  hash: string;
  author: string;
  /** ISO 8601. */
  date: string;
  subject: string;
}

export interface GitBranch {
  name: string;
  current: boolean;
}

export const git = {
  /** `null` when the workspace is not inside a git repository. */
  status: () => invoke<GitStatus | null>("git_status"),
  /** File content at HEAD or in the index; `null` when the file is absent there. */
  show: (path: string, rev: "head" | "index") => invoke<string | null>("git_show", { path, rev }),
  stage: (paths: string[]) => invoke<void>("git_stage", { paths }),
  unstage: (paths: string[]) => invoke<void>("git_unstage", { paths }),
  /** Restores tracked files from the index. Untracked files are never deleted. */
  discard: (paths: string[]) => invoke<void>("git_discard", { paths }),
  /** Returns the short hash of the new commit. */
  commit: async (message: string) =>
    (await invoke<{ hash: string }>("git_commit", { message })).hash,
};

// Typed wrappers with an explicit `root` (an absolute path inside the open workspace;
// the backend canonicalizes it and rejects anything outside).

/** `null` when `root` is not inside a git repository. */
export const gitStatus = (root: string) => invoke<GitStatus | null>("git_status", { root });

/** `staged`: HEAD vs index; otherwise index vs working tree. A missing side is `""`. */
export const gitDiffFile = (root: string, path: string, staged: boolean) =>
  invoke<GitDiff>("git_diff_file", { root, path, staged });

export const gitStage = (root: string, paths: string[]) =>
  invoke<null>("git_stage", { root, paths });

export const gitUnstage = (root: string, paths: string[]) =>
  invoke<null>("git_unstage", { root, paths });

/** Restores tracked files from the index. Untracked files are never deleted. */
export const gitDiscard = (root: string, paths: string[]) =>
  invoke<null>("git_discard", { root, paths });

/** Rejects an empty message. */
export const gitCommit = (root: string, message: string) =>
  invoke<{ hash: string }>("git_commit", { root, message });

/** `limit` must be 1..200. */
export const gitLog = (root: string, limit: number) =>
  invoke<GitLogEntry[]>("git_log", { root, limit });

export const gitBranches = (root: string) => invoke<GitBranch[]>("git_branches", { root });

/** Switches to an existing local branch; name must match `^[A-Za-z0-9._/-]{1,200}$`, no leading `-`. */
export const gitCheckout = (root: string, branch: string) =>
  invoke<null>("git_checkout", { root, branch });
