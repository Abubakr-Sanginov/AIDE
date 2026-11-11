import { fs } from "@/api/fs";
import { git, type GitFile } from "@/api/git";
import { useTabs, type Tab } from "@/stores/tabs";
import { featureText } from "@/i18n/features";
import { useGit } from "@/features/git/store";
import { isUntracked, joinRepoPath, splitRel } from "@/features/git/model";
import { useDiff } from "@/features/diff/store";

// Beyond this the merge view gets slow; the backend caps blobs at 4 MB as well.
const MAX_CHARS = 6 * 1024 * 1024;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function withLoading(fn: () => Promise<void>) {
  const diff = useDiff.getState();
  if (diff.loading) return;
  diff.setLoading(true);
  try {
    await fn();
  } catch (e) {
    useTabs.getState().setError(errText(e));
  } finally {
    useDiff.getState().setLoading(false);
  }
}

/**
 * Staged: HEAD -> index. Unstaged: index -> file on disk (saved content).
 * Missing sides (new / deleted files) are shown as empty documents.
 */
export function openGitDiff(file: GitFile, staged: boolean) {
  return withLoading(async () => {
    const status = useGit.getState().status;
    if (!status) return;
    const ft = featureText();
    const abs = joinRepoPath(status.top, file.path);
    let left: string;
    let right: string;
    let leftLabel: string;
    let rightLabel: string;
    if (staged) {
      left = file.index === "A" ? "" : ((await git.show(file.orig_path ?? file.path, "head")) ?? "");
      right = file.index === "D" ? "" : ((await git.show(file.path, "index")) ?? "");
      leftLabel = ft.diffHead;
      rightLabel = ft.diffIndex;
    } else {
      left = isUntracked(file) ? "" : ((await git.show(file.path, "index")) ?? "");
      right = file.worktree === "D" ? "" : await fs.readFile(abs);
      leftLabel = ft.diffIndex;
      rightLabel = ft.diffWorktree;
    }
    if (left.length + right.length > MAX_CHARS) throw new Error(ft.diffTooLarge);
    useDiff.getState().show({ title: splitRel(file.path).name, path: abs, left, right, leftLabel, rightLabel });
  });
}

/**
 * Contract entry point: shows any two texts side by side in the diff tab.
 * `path` is used for language detection; labels default to HEAD vs working copy.
 */
export function openDiff(opts: {
  path: string;
  original: string;
  modified: string;
  title?: string;
  leftLabel?: string;
  rightLabel?: string;
}): void {
  const ft = featureText();
  if (opts.original.length + opts.modified.length > MAX_CHARS) {
    useTabs.getState().setError(ft.diffTooLarge);
    return;
  }
  useDiff.getState().show({
    title: opts.title ?? splitRel(opts.path.replace(/\\/g, "/")).name,
    path: opts.path,
    left: opts.original,
    right: opts.modified,
    leftLabel: opts.leftLabel ?? ft.diffHead,
    rightLabel: opts.rightLabel ?? ft.diffWorktree,
  });
}

/** Saved file on disk vs. the unsaved editor buffer. */
export function compareWithSaved(tab: Tab) {
  return withLoading(async () => {
    const ft = featureText();
    const disk = await fs.readFile(tab.path);
    const current = useTabs.getState().tabs.find((t) => t.id === tab.id)?.content ?? tab.content;
    if (disk.length + current.length > MAX_CHARS) throw new Error(ft.diffTooLarge);
    useDiff.getState().show({
      title: tab.name,
      path: tab.path,
      left: disk,
      right: current,
      leftLabel: ft.diffSaved,
      rightLabel: ft.diffUnsaved,
    });
  });
}
