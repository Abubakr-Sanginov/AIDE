// Pure helpers for git status (no imports: covered by tests/git-model.test.ts).

export interface GitFileLike {
  path: string;
  orig_path: string | null;
  index: string;
  worktree: string;
}

const CONFLICTS = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

export function isConflict(f: GitFileLike): boolean {
  return CONFLICTS.has(f.index + f.worktree);
}

export function isUntracked(f: GitFileLike): boolean {
  return f.index === "?";
}

/** Has changes recorded in the index. */
export function isStaged(f: GitFileLike): boolean {
  return !isConflict(f) && !isUntracked(f) && f.index !== " " && f.index !== "!";
}

/** Has changes in the working tree that are not in the index (incl. untracked). */
export function isUnstaged(f: GitFileLike): boolean {
  if (isConflict(f)) return false;
  return isUntracked(f) || (f.worktree !== " " && f.worktree !== "!");
}

export function groupFiles<T extends GitFileLike>(files: T[]): { staged: T[]; changes: T[]; conflicts: T[] } {
  const byPath = (a: T, b: T) => a.path.localeCompare(b.path);
  return {
    staged: files.filter(isStaged).sort(byPath),
    changes: files.filter(isUnstaged).sort(byPath),
    conflicts: files.filter(isConflict).sort(byPath),
  };
}

/** Letter shown next to a file: VS Code style (U = untracked, ! = conflict). */
export function statusLetter(f: GitFileLike, staged: boolean): string {
  if (isConflict(f)) return "!";
  if (isUntracked(f)) return "U";
  return staged ? f.index : f.worktree;
}

/** Paths to send for stage/unstage; an unstaged rename needs both sides. */
export function pathsFor(f: GitFileLike, staged: boolean): string[] {
  return staged && f.orig_path ? [f.path, f.orig_path] : [f.path];
}

/** Repo root + repo-relative path, using the root's own separator (tabs are keyed by path). */
export function joinRepoPath(top: string, rel: string): string {
  const sep = top.includes("\\") ? "\\" : "/";
  return top.replace(/[\\/]+$/, "") + sep + rel.split("/").join(sep);
}

export function splitRel(rel: string): { name: string; dir: string } {
  const i = rel.lastIndexOf("/");
  return i < 0 ? { name: rel, dir: "" } : { name: rel.slice(i + 1), dir: rel.slice(0, i) };
}
