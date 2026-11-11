import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  GitBranch,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Undo2,
} from "lucide-react";
import type { GitFile } from "@/api/git";
import { useI18n } from "@/i18n";
import { fmt, useFeatureText } from "@/i18n/features";
import { useWorkspace } from "@/stores/workspace";
import { useTabs } from "@/stores/tabs";
import { useGit } from "@/features/git/store";
import { groupFiles, isUntracked, joinRepoPath, pathsFor, splitRel, statusLetter } from "@/features/git/model";
import { openGitDiff } from "@/features/diff/open";

const LETTER_COLOR: Record<string, string> = {
  M: "text-amber-300",
  A: "text-emerald-400",
  U: "text-emerald-400",
  D: "text-red-400",
  R: "text-sky-300",
  C: "text-sky-300",
  T: "text-amber-300",
  "!": "text-red-400",
};

type SectionId = "conflicts" | "staged" | "changes";

export function GitPanel() {
  const { t } = useI18n();
  const ft = useFeatureText();
  const root = useWorkspace((s) => s.root);
  const status = useGit((s) => s.status);
  const loaded = useGit((s) => s.loaded);
  const loading = useGit((s) => s.loading);
  const busy = useGit((s) => s.busy);
  const error = useGit((s) => s.error);
  const statusError = useGit((s) => s.statusError);
  const message = useGit((s) => s.message);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<SectionId, boolean>>({ conflicts: false, staged: false, changes: false });
  const confirmTimer = useRef<number | undefined>(undefined);

  // The .git folder is not watched, so poll while the panel is open (commands run in the terminal).
  useEffect(() => {
    void useGit.getState().refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void useGit.getState().refresh();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [root]);

  useEffect(() => () => window.clearTimeout(confirmTimer.current), []);

  const groups = useMemo(() => groupFiles(status?.files ?? []), [status]);

  const askDiscard = (key: string, run: () => void) => {
    if (confirm === key) {
      window.clearTimeout(confirmTimer.current);
      setConfirm(null);
      run();
      return;
    }
    setConfirm(key);
    window.clearTimeout(confirmTimer.current);
    confirmTimer.current = window.setTimeout(() => setConfirm(null), 3000);
  };

  const doCommit = async () => {
    setNotice(null);
    const hash = await useGit.getState().commit();
    if (hash) setNotice(fmt(ft.committed, { hash }));
  };

  if (!root) {
    return (
      <div className="px-4 py-10 text-center text-[12px] leading-5 text-ink-600">
        {t("explorer.openFolderHint")}
        <br />
        {t("explorer.openFolderHint2")}
      </div>
    );
  }

  const header = (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-white/[0.055] px-3">
      <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-ink-500">
        {ft.scmTitle}
      </span>
      {loading && <Loader2 size={12} className="shrink-0 animate-spin text-ink-500" aria-hidden />}
      <button
        title={ft.refresh}
        aria-label={ft.refresh}
        onClick={() => void useGit.getState().refresh()}
        className="flex size-7 items-center justify-center rounded-md text-ink-500 hover:bg-white/[0.06] hover:text-ink-100"
      >
        <RefreshCw size={13} />
      </button>
    </div>
  );

  if (!loaded) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-ink-600">
          <Loader2 size={13} className="animate-spin" /> {t("common.loading")}
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="px-4 py-10 text-center text-[12px] leading-5 text-ink-500">
          {statusError ? (
            <span className="text-red-400">{statusError}</span>
          ) : (
            <>
              {ft.notRepo}
              <br />
              <span className="text-ink-600">{ft.notRepoHint}</span>
            </>
          )}
        </div>
      </div>
    );
  }

  const total = groups.staged.length + groups.changes.length + groups.conflicts.length;

  const row = (f: GitFile, section: SectionId) => {
    const staged = section === "staged";
    const { name, dir } = splitRel(f.path);
    const letter = statusLetter(f, staged);
    const key = section + ":" + f.path;
    const abs = joinRepoPath(status.top, f.path);
    const deleted = (staged ? f.index : f.worktree) === "D";
    return (
      <div
        key={key}
        className="group flex h-7 items-center gap-1.5 pl-5 pr-1.5 text-[12.5px] hover:bg-white/[0.04]"
      >
        <button
          onClick={() => void openGitDiff(f, staged)}
          title={f.orig_path ? `${f.orig_path} → ${f.path}` : f.path}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <FileText size={12} className="shrink-0 text-ink-600" aria-hidden />
          <span className={"truncate " + (deleted ? "text-ink-500 line-through" : "text-ink-200")}>{name}</span>
          {dir && <span className="min-w-0 truncate text-[11px] text-ink-600">{dir}</span>}
        </button>
        <div className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {!deleted && (
            <IconBtn label={ft.openFile} onClick={() => void useTabs.getState().open(abs)}>
              <FileText size={12} />
            </IconBtn>
          )}
          {section === "changes" && !isUntracked(f) && (
            <IconBtn
              label={confirm === key ? ft.discardConfirm : ft.discard}
              danger={confirm === key}
              disabled={busy}
              onClick={() => askDiscard(key, () => void useGit.getState().discard([f.path]))}
            >
              {confirm === key ? <Check size={12} /> : <Undo2 size={12} />}
            </IconBtn>
          )}
          {staged ? (
            <IconBtn label={ft.unstage} disabled={busy} onClick={() => void useGit.getState().unstage(pathsFor(f, true))}>
              <Minus size={12} />
            </IconBtn>
          ) : (
            <IconBtn label={ft.stage} disabled={busy} onClick={() => void useGit.getState().stage(pathsFor(f, false))}>
              <Plus size={12} />
            </IconBtn>
          )}
        </div>
        <span className={"w-3 shrink-0 text-center font-mono text-[11px] font-semibold " + (LETTER_COLOR[letter] ?? "text-ink-400")}>
          {letter}
        </span>
      </div>
    );
  };

  const section = (id: SectionId, title: string, files: GitFile[]) => {
    if (files.length === 0) return null;
    const open = !collapsed[id];
    const all = files.flatMap((f) => pathsFor(f, id === "staged"));
    return (
      <div key={id}>
        <div className="group flex h-7 items-center gap-1 pl-1.5 pr-1.5">
          <button
            onClick={() => setCollapsed((c) => ({ ...c, [id]: !c[id] }))}
            aria-expanded={open}
            className="flex min-w-0 flex-1 items-center gap-1 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-400 hover:text-ink-200"
          >
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <span className="truncate">{title}</span>
          </button>
          {id === "staged" ? (
            <IconBtn label={ft.unstageAll} disabled={busy} onClick={() => void useGit.getState().unstage(all)}>
              <Minus size={12} />
            </IconBtn>
          ) : (
            <IconBtn label={ft.stageAll} disabled={busy} onClick={() => void useGit.getState().stage(all)}>
              <Plus size={12} />
            </IconBtn>
          )}
          <span className="min-w-5 rounded-full bg-white/[0.07] px-1.5 text-center text-[10px] text-ink-300">{files.length}</span>
        </div>
        {open && files.map((f) => row(f, id))}
      </div>
    );
  };

  const canCommit = !busy && message.trim() !== "" && groups.staged.length > 0;

  return (
    <div className="flex h-full flex-col">
      {header}
      <div className="shrink-0 space-y-2 border-b border-white/[0.055] px-3 py-2.5">
        <div className="flex items-center gap-2 text-[12px] text-ink-400">
          <GitBranch size={12} className="shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{status.branch ?? ft.detached}</span>
          {status.ahead > 0 && (
            <span className="flex items-center gap-0.5" title={fmt(ft.ahead, { n: status.ahead })}>
              <ArrowUp size={11} />
              {status.ahead}
            </span>
          )}
          {status.behind > 0 && (
            <span className="flex items-center gap-0.5" title={fmt(ft.behind, { n: status.behind })}>
              <ArrowDown size={11} />
              {status.behind}
            </span>
          )}
        </div>
        <textarea
          value={message}
          rows={2}
          aria-label={ft.commitPlaceholder}
          placeholder={ft.commitPlaceholder}
          spellCheck={false}
          onChange={(e) => useGit.getState().setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void doCommit();
            }
          }}
          className="block max-h-40 min-h-[52px] w-full resize-y rounded-lg border border-white/[0.09] bg-black/20 px-2.5 py-2 text-[13px] text-ink-200 placeholder-ink-600 outline-none focus:border-brand-400/50"
        />
        <button
          onClick={() => void doCommit()}
          disabled={!canCommit}
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-brand-300 text-[13px] font-medium text-ink-950 transition-colors hover:bg-brand-200 disabled:cursor-not-allowed disabled:bg-white/[0.06] disabled:text-ink-500"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          {busy ? ft.committing : ft.commit}
        </button>
        {error && (
          <button
            onClick={() => useGit.getState().clearError()}
            className="block w-full whitespace-pre-wrap break-words text-left text-[11.5px] leading-4 text-red-400"
          >
            {error}
          </button>
        )}
        {notice && !error && <div className="text-[11.5px] text-emerald-400">{notice}</div>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {total === 0 ? (
          <div className="px-4 py-8 text-center text-[12px] text-ink-600">{ft.noChanges}</div>
        ) : (
          <>
            {section("conflicts", ft.conflicts, groups.conflicts)}
            {section("staged", ft.staged, groups.staged)}
            {section("changes", ft.changes, groups.changes)}
          </>
        )}
        {status.truncated && <div className="px-4 py-2 text-[11px] text-amber-300">{ft.truncated}</div>}
      </div>
    </div>
  );
}

export default GitPanel;

function IconBtn({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={
        "flex size-6 items-center justify-center rounded-md disabled:opacity-40 " +
        (danger ? "bg-red-500/20 text-red-300" : "text-ink-500 hover:bg-white/[0.08] hover:text-ink-100")
      }
    >
      {children}
    </button>
  );
}
