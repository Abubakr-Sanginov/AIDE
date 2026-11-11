import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/ui/Markdown";
import { ArrowUp, CheckCircle2, CircleAlert, Loader2, Phone, Square, Users } from "lucide-react";
import { type PermissionMode } from "@/api/ai";
import { Select } from "@/ui/Select";
import { useAi } from "@/stores/ai";
import { Avatar } from "./Avatar";
import { CallView } from "./CallView";
import { lang, sendToKins, stopKins } from "./engine";
import { KinsSidePanel } from "./SidePanel";
import { PRESETS, ROLE_BY_ID, type RoleId } from "./roles";
import { useKins, type FeedItem, type KinsTask } from "./store";
import { useKinsText } from "./strings";
import { TeamDialog } from "./TeamDialog";

function Composer({ placeholder, taskId }: { placeholder: string; taskId?: string }) {
  const T = useKinsText();
  const [text, setText] = useState("");
  const running = useKins((s) => s.running);
  const permissionMode = useAi((s) => s.permissionMode);
  const hasKey = useAi((s) => s.hasKey);
  const brief = useKins((s) => s.call.lines.length);
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const v = text.trim();
    if (!v || running) return;
    setText("");
    void sendToKins(v, taskId);
  };
  const perms: { value: PermissionMode; label: string }[] = [
    { value: "ask", label: T.askPerm },
    { value: "auto", label: T.autoPerm },
    { value: "full", label: T.freedom },
  ];

  return (
    <div className="w-full">
      <div className="aide-composer rounded-xl border border-line-strong bg-raised px-3 pb-2 pt-2" data-busy={running}>
        <textarea
          ref={ref}
          value={text}
          rows={2}
          maxLength={8000}
          placeholder={hasKey ? placeholder : T.noKey}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          className="block max-h-40 min-h-[52px] w-full resize-none bg-transparent px-1 py-1 text-[15px] leading-6 text-ink-100 outline-none placeholder:text-ink-500"
        />
        <div className="flex h-9 items-center gap-1">
          {brief > 0 && (
            <span className="flex items-center gap-1 rounded-lg bg-white/[0.06] px-2 py-1 text-[12px] text-ink-300">
              <Phone size={12} /> {brief}
            </span>
          )}
          <Select
            title={T.freedom}
            value={permissionMode}
            options={perms}
            onChange={(v) => useAi.getState().setPermissionMode(v as PermissionMode)}
            className="text-[13px]"
            menuMinWidth={150}
          />
          <div className="ml-auto">
            {running ? (
              <button
                onClick={stopKins}
                aria-label={T.stop}
                title={T.stop}
                className="flex size-8 items-center justify-center rounded-full bg-white/[0.1] text-ink-50 hover:bg-white/[0.16]"
              >
                <Square size={12} fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={submit}
                aria-label={T.send}
                disabled={!text.trim()}
                className="flex size-8 items-center justify-center rounded-full bg-teal-300 text-canvas transition-colors hover:bg-teal-200 disabled:bg-white/[0.06] disabled:text-ink-600"
              >
                <ArrowUp size={16} strokeWidth={2.4} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Home() {
  const T = useKinsText();
  const preset = useKins((s) => s.team.preset);
  const customRoles = useKins((s) => s.team.customRoles);
  const l = lang();
  return (
    <div className="aide-scroll flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6">
      <div className="my-auto flex w-full max-w-[680px] flex-col py-8">
        <h1 className="text-[26px] font-semibold tracking-tight text-ink-50">{T.whichTeam}</h1>
        <p className="mt-1.5 text-[14px] text-ink-400">{T.ceoLine}</p>

        {/* Crew presets as a vertical list with a selection bar */}
        <div role="radiogroup" aria-label={T.whichTeam} className="mt-6 divide-y divide-line/70 overflow-hidden rounded-lg border border-line">
          {PRESETS.map((p) => {
            const roles: RoleId[] = p.id === "custom" ? customRoles : p.roles;
            const on = preset === p.id;
            return (
              <button
                key={p.id}
                role="radio"
                aria-checked={on}
                onClick={() => useKins.getState().setPreset(p.id)}
                className={
                  "relative flex w-full items-center gap-4 px-4 py-3 text-left transition-colors " +
                  (on ? "bg-teal-300/[0.06]" : "hover:bg-white/[0.03]")
                }
              >
                <span className={"absolute inset-y-0 left-0 w-[3px] " + (on ? "bg-teal-300" : "bg-transparent")} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[15px] font-semibold text-ink-50">{p.name[l]}</span>
                    <span className="text-[12.5px] text-ink-500">{p.id === "custom" ? T.customHint : T.rolesCount(roles.length)}</span>
                  </div>
                  <div className="mt-0.5 text-[13.5px] leading-5 text-ink-400">{p.blurb[l]}</div>
                </div>
                <div className="flex shrink-0 gap-1">
                  {roles.slice(0, 6).map((r) => (
                    <Avatar key={r} role={r} size={26} />
                  ))}
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13.5px]">
          <button
            onClick={() => useKins.getState().openTeamDialog(preset)}
            className="flex items-center gap-1.5 text-ink-300 underline decoration-ink-700 underline-offset-4 transition-colors hover:text-ink-50"
          >
            <Users size={14} />
            {T.teamAndModels}
          </button>
          <button
            onClick={() => useKins.getState().setView("call")}
            className="flex items-center gap-1.5 text-ink-300 underline decoration-ink-700 underline-offset-4 transition-colors hover:text-ink-50"
          >
            <Phone size={14} />
            {T.discussFirst}
          </button>
        </div>

        <div className="mt-7 w-full">
          <Composer placeholder={T.composerPlaceholder} />
        </div>
      </div>
    </div>
  );
}

function FeedRow({ item }: { item: FeedItem }) {
  const l = lang();
  if (item.role === "ceo") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-[26px] bg-raised px-4 py-2.5 text-[14.5px] leading-6 text-ink-50">{item.text}</div>
      </div>
    );
  }
  const name = item.role === "system" ? "AIDE" : ROLE_BY_ID[item.role].name[l];
  const tone =
    item.kind === "final"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
      : item.kind === "error"
        ? "border-red-500/30 bg-red-500/10 text-red-100"
        : item.kind === "check"
          ? "border-line bg-white/[0.04] text-ink-200"
          : "border-transparent bg-transparent text-ink-200";
  return (
    <div className="flex gap-3">
      {item.role === "system" ? (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-ink-300">
          <CircleAlert size={15} />
        </div>
      ) : (
        <Avatar role={item.role} size={32} />
      )}
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center gap-2 text-[13px] font-medium text-ink-100">
          {name}
          {item.kind === "check" && <span className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[11px] font-normal text-ink-300">QA</span>}
          {item.kind === "final" && <CheckCircle2 size={14} className="text-emerald-400" />}
        </div>
        <div className={"aide-scroll max-h-[520px] overflow-auto break-words rounded-xl border px-3 py-2 text-[14px] leading-6 " + tone}><Markdown content={item.text} /></div>
      </div>
    </div>
  );
}

function Feed({ task }: { task: KinsTask }) {
  const T = useKinsText();
  const running = useKins((s) => s.running);
  const activeRole = useKins((s) => s.activeRole);
  const ref = useRef<HTMLDivElement>(null);
  const l = lang();

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [task.feed.length, task.feed[task.feed.length - 1]?.text.length]);

  const phaseText = T.phase[task.phase];
  return (
    <>
      <div ref={ref} className="aide-scroll min-h-0 flex-1 overflow-y-auto px-[max(1.5rem,calc((100%-820px)/2))] py-5">
        <div className="space-y-5">
          {task.feed.map((f) => (
            <FeedRow key={f.id} item={f} />
          ))}
        </div>
      </div>
      <div className="mx-auto w-full max-w-[820px] px-6">
        {phaseText && (
          <div className="mb-2 flex items-center gap-2 text-[13px] text-ink-400" aria-live="polite">
            {running ? <Loader2 size={13} className="animate-spin" /> : task.phase === "done" ? <CheckCircle2 size={13} className="text-emerald-400" /> : <CircleAlert size={13} className={task.phase === "blocked" ? "text-red-400" : ""} />}
            {phaseText}
            {running && activeRole && <span className="text-ink-500">· {ROLE_BY_ID[activeRole].name[l]}</span>}
          </div>
        )}
        <Composer placeholder={T.composerFollow} taskId={task.id} />
      </div>
    </>
  );
}

export function KinsView() {
  const view = useKins((s) => s.view);
  const task = useKins((s) => s.tasks.find((t) => t.id === s.activeId) ?? null);
  return (
    <>
      <main className="aide-island relative mx-1.5 flex min-w-0 flex-1 flex-col">
        {view === "call" ? <CallView /> : task ? <Feed task={task} /> : <Home />}
      </main>
      <SideHost />
      <TeamDialog />
    </>
  );
}

/** The crew inside the IDE's right panel (no preview side panel: the room is tight). */
export function KinsPane() {
  const view = useKins((s) => s.view);
  const task = useKins((s) => s.tasks.find((t) => t.id === s.activeId) ?? null);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <main className="aide-vt-vibe relative flex min-h-0 min-w-0 flex-1 flex-col">{view === "call" ? <CallView /> : task ? <Feed task={task} /> : <Home />}</main>
      <TeamDialog />
    </div>
  );
}

function SideHost() {
  const open = useKins((s) => s.sideOpen);
  return open ? <KinsSidePanel /> : null;
}
