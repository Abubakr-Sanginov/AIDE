import { AlertTriangle, CircleAlert, GitBranch, Loader2, Sparkles, WifiOff } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useUi } from "@/stores/ui";
import { useEffect, useState } from "react";
import { useI18n } from "@/i18n";
import { fmt, useFeatureText } from "@/i18n/features";
import { useTabs } from "@/stores/tabs";
import { useWorkspace } from "@/stores/workspace";
import { useAi } from "@/stores/ai";
import { basename } from "@/lib/fsUtils";
import { useExtHost } from "@/features/exthost/store";

export function StatusBar() {
  const { t } = useI18n();
  const ft = useFeatureText();
  const root = useWorkspace((s) => s.root);
  const active = useTabs((s) => s.tabs.find((tab) => tab.id === s.activeId));
  const cursor = useTabs((s) => s.cursor);
  const error = useTabs((s) => s.error);
  const setError = useTabs((s) => s.setError);
  const mode = useAi((s) => s.mode);
  const model = useAi((s) => s.model);
  const providerName = useAi((s) => s.providers.find((p) => p.id === s.providerId)?.name);
  const [online, setOnline] = useState(navigator.onLine);
  const streaming = useAi((s) => s.streaming);
  const diagnostics = useExtHost((s) => s.diagnostics);
  const [branch, setBranch] = useState<string | null>(null);
  const counts = Object.values(diagnostics).reduce((acc, list) => {
    for (const d of list) {
      if (d.severity === 0) acc.errors++;
      else if (d.severity === 1) acc.warnings++;
    }
    return acc;
  }, { errors: 0, warnings: 0 });

  useEffect(() => {
    let alive = true;
    const read = () => void invoke<string | null>("git_branch").then((b) => alive && setBranch(b ?? null)).catch(() => alive && setBranch(null));
    read();
    const timer = window.setInterval(read, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [root]);

  const openProblems = () => {
    useUi.setState({ dockTab: "problems", terminalVisible: true });
  };
  const extItems = useExtHost((s) => s.statusItems);
  const leftExt = Object.values(extItems).filter((i) => i.alignment !== 2).sort((a, b) => b.priority - a.priority);
  const rightExt = Object.values(extItems).filter((i) => i.alignment === 2).sort((a, b) => b.priority - a.priority);
  const extButton = (i: (typeof leftExt)[number]) => (
    <button
      key={i.id}
      title={i.tooltip || undefined}
      disabled={!i.command}
      onClick={() => i.command && void useExtHost.getState().runCommand(i.command).catch(() => {})}
      className="max-w-[220px] truncate hover:text-ink-100 disabled:hover:text-ink-400"
    >
      {i.text.replace(/\$\([\w-]+\)\s*/g, "")}
    </button>
  );

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const modeLabel =
    mode === "agent" ? t("statusBar.agent") : mode === "plan" ? t("statusBar.plan") : t("statusBar.chat");

  return (
    <footer className="flex h-8 shrink-0 select-none items-center justify-between gap-3 px-3 text-[12px] text-ink-400">
      <div className="flex min-w-0 items-center gap-3">
        {branch ? (
          <button
            onClick={() => useUi.getState().setPanel("git")}
            className="flex shrink-0 items-center gap-1.5 hover:text-ink-100"
            title={ft.scmShortcut}
          >
            <GitBranch size={12} />
            {branch}
          </button>
        ) : (
          <span className="shrink-0" title={root ?? undefined}>
            {root ? basename(root) : t("statusBar.noFolder")}
          </span>
        )}
        <button onClick={openProblems} className="flex shrink-0 items-center gap-2 hover:text-ink-100" title="Problems">
          <span className="flex items-center gap-1">
            <CircleAlert size={12} />
            <span key={counts.errors} className="aide-bump inline-block tabular-nums">{counts.errors}</span>
          </span>
          <span className="flex items-center gap-1">
            <AlertTriangle size={12} />
            <span key={counts.warnings} className="aide-bump inline-block tabular-nums">{counts.warnings}</span>
          </span>
        </button>
        {streaming && (
          <span className="aide-slide-in-left flex shrink-0 items-center gap-1.5 text-teal-200">
            <Loader2 size={12} className="animate-spin" />
            {t("statusBar.agent")}…
          </span>
        )}
        {leftExt.map(extButton)}
        {error && (
          <button
            title={error}
            onClick={() => setError(null)}
            className="aide-shake min-w-0 truncate text-red-400 hover:text-red-300"
          >
            {error}
          </button>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {rightExt.map(extButton)}
        {!online && (
          <span title={t("statusBar.offline")} className="flex items-center">
            <WifiOff size={11} />
          </span>
        )}
        {model && (
          <span
            className="flex max-w-[240px] items-center gap-1 truncate"
            title={providerName ? `${providerName} · ${model}` : model}
          >
            <span className="size-1.5 shrink-0 rounded-full bg-ink-300" aria-hidden />
            <span className="truncate">{model}</span>
          </span>
        )}
        <span key={modeLabel} className="aide-fade-in flex items-center gap-1 text-ink-300">
          <Sparkles size={11} />
          {modeLabel}
        </span>
        {active && (
          <>
            <span>
              {t("statusBar.line")} {cursor.line}, {t("statusBar.column")} {cursor.col}
            </span>
            {(cursor.sel ?? 1) > 1 && <span className="text-ink-200">{fmt(ft.selections, { n: cursor.sel ?? 1 })}</span>}
            <span>{active.language}</span>
          </>
        )}
        <span>UTF-8</span>
      </div>
    </footer>
  );
}
