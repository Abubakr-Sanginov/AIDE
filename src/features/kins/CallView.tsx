import { rt } from "@/i18n/tgMap";
import { isRuLike } from "@/i18n/ruLike";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Hand, LogOut, Mic, Play, Send, Volume2, VolumeX } from "lucide-react";
import { Avatar } from "./Avatar";
import { callTurn, lang, sendToKins } from "./engine";
import { ROLE_BY_ID, type RoleId } from "./roles";
import { useKins, type Mood } from "./store";
import { useKinsText } from "./strings";
import { canTalk, listenBest, refreshWhisper, speak, stopSpeaking, type Listener } from "./voice";

function Seat({ role, mood }: { role: RoleId; mood: Mood }) {
  const l = lang();
  const T = useKinsText();
  const ring =
    mood === "speaking"
      ? "shadow-[0_0_0_2px_rgb(94_234_212)]"
      : mood === "wants"
        ? "shadow-[0_0_0_2px_rgb(251_191_36)]"
        : mood === "thinking"
          ? "shadow-[0_0_0_1px_rgba(94,234,212,0.5)]"
          : "shadow-[0_0_0_1px_rgba(255,255,255,0.08)]";
  const label = mood === "speaking" ? T.speakingNow : mood === "wants" ? T.wantsToSpeak : mood === "thinking" ? T.thinkingNow : "";
  return (
    <div className={"flex w-[100px] flex-col items-center gap-2 transition-opacity " + (mood === "idle" ? "opacity-70" : "")}>
      <div className="relative">
        <div className={"rounded-full p-1 transition-shadow " + ring + (mood === "thinking" ? " animate-pulse" : "")}>
          <Avatar role={role} size={64} mood={mood} />
        </div>
        {mood === "wants" && (
          <span className="absolute -right-1 -top-1 flex size-6 animate-bounce items-center justify-center rounded-full bg-amber-300 text-canvas">
            <Hand size={13} />
          </span>
        )}
      </div>
      <div className="text-center">
        <div className="text-[12.5px] font-medium text-ink-100">{ROLE_BY_ID[role].name[l]}</div>
        <div className="flex h-4 items-center justify-center gap-1 text-[11.5px] text-ink-400" aria-live="polite">
          {mood === "speaking" &&
            [0, 1, 2].map((i) => <span key={i} className="h-2.5 w-0.5 animate-pulse rounded-full bg-teal-300" style={{ animationDelay: `${i * 140}ms` }} />)}
          {label}
          {mood === "thinking" && <span className="animate-pulse">…</span>}
        </div>
      </div>
    </div>
  );
}

/** Voice call: the crew sits in a row on top, the conversation reads as live captions below. */
export function CallView() {
  const T = useKinsText();
  const roles = useKins((s) => s.roles());
  const call = useKins((s) => s.call);
  const moods = useKins((s) => s.moods);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(canTalk() ? null : T.noVoice);
  const listener = useRef<Listener | null>(null);
  const busyRef = useRef(false);
  const captions = useRef<HTMLDivElement>(null);
  const l = lang();

  useEffect(() => {
    void refreshWhisper().then(() => setNote(canTalk() ? null : T.noVoice));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = captions.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [call.lines.length]);

  const say = useCallback(
    async (text: string) => {
      const phrase = text.trim();
      const k = useKins.getState();
      if (!phrase || busyRef.current) return;
      busyRef.current = true;
      stopSpeaking();
      k.pushCallLine({ who: "ceo", text: phrase });
      k.setCall({ busy: true });
      k.setActiveRole("lead");
      // The model composes the whole discussion in one go: everyone is thinking until it answers.
      k.setMoods(Object.fromEntries(k.roles().map((r) => [r, "thinking" as Mood])));
      try {
        const spoken = await callTurn(
          phrase,
          (roleId, tool) => {
            k.setActiveRole(roleId);
            k.setMoods({ [roleId]: "speaking" as Mood });
            setNote(`${ROLE_BY_ID[roleId]?.name[l] ?? roleId}: ${tool}`);
          },
          (roleId, line) => {
            k.pushCallLine({ who: roleId, text: line.text, tools: line.tools });
          },
        );
        for (let i = 0; i < spoken.length; i++) {
          const part = spoken[i];
          const s = useKins.getState();
          // The speaker talks; those with lines still queued have a hand up; the rest wait.
          const next: Partial<Record<RoleId, Mood>> = {};
          for (const r of s.roles()) next[r] = "idle";
          for (const later of spoken.slice(i + 1)) next[later.who] = "wants";
          next[part.who] = "speaking";
          s.setMoods(next);
          s.setActiveRole(part.who);
          // If already pushed by streaming action, don't duplicate
          const existing = s.call.lines;
          const already = existing.some((l) => l.who === part.who && l.text === part.text);
          if (!already) {
            s.pushCallLine({ who: part.who, text: part.text, tools: part.tools });
          }
          if (!s.call.muted) await speak(part.text, l, part.who);
          else await new Promise((r) => setTimeout(r, Math.min(2500, 400 + part.text.length * 25)));
        }
        setNote(null);
      } catch (e) {
        setNote(String(e instanceof Error ? e.message : e));
      } finally {
        busyRef.current = false;
        const s = useKins.getState();
        s.setCall({ busy: false });
        s.setActiveRole(null);
        s.setMoods({});
      }
    },
    [l],
  );

  const startTalk = useCallback(() => {
    if (listener.current || busyRef.current) return;
    stopSpeaking();
    const h = listenBest(
      l,
      (text) => void say(text),
      (reason) =>
        setNote(
          reason.startsWith("stt:")
            ? reason.slice(4)
            : `${T.voiceProblem} (${reason}). ${isRuLike(l) ? rt("Надёжнее всего работает Whisper: Настройки → Голос, ключ Groq.") : "Whisper is the reliable option: Settings → Voice, Groq key."}`,
        ),
    );
    if (!h) {
      setNote(T.noVoice);
      return;
    }
    listener.current = h;
    useKins.getState().setCall({ listening: true });
  }, [l, say, T.noVoice, T.voiceProblem]);

  const endTalk = useCallback(() => {
    listener.current?.finish();
    listener.current = null;
    useKins.getState().setCall({ listening: false });
  }, []);

  // Hold Space to talk (layout independent: uses the physical key).
  useEffect(() => {
    const typing = (e: KeyboardEvent) => (e.target as HTMLElement | null)?.closest("input, textarea") !== null;
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || typing(e)) return;
      e.preventDefault();
      startTalk();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || typing(e)) return;
      e.preventDefault();
      endTalk();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      listener.current?.cancel();
      listener.current = null;
      stopSpeaking();
    };
  }, [startTalk, endTalk]);

  const leaveCall = () => {
    stopSpeaking();
    listener.current?.cancel();
    listener.current = null;
    const k = useKins.getState();
    k.setCall({ listening: false, busy: false });
    k.setActiveRole(null);
    k.setMoods({});
    k.setView("feed");
  };

  const hangUpAndStartWork = () => {
    stopSpeaking();
    listener.current?.cancel();
    listener.current = null;
    const k = useKins.getState();
    k.setCall({ listening: false, busy: false });
    k.setActiveRole(null);
    k.setMoods({});
    k.setView("feed");
    const lastCeo = [...k.call.lines].reverse().find((l) => l.who === "ceo")?.text;
    const taskTitle = lastCeo || (isRuLike(l) ? "Реализация по итогам созвона" : "Implementation from call");
    void sendToKins(taskTitle);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between px-5 pt-4">
        <button onClick={leaveCall} className="flex items-center gap-1.5 text-[13.5px] text-ink-400 transition-colors hover:text-ink-50">
          <ArrowLeft size={15} />
          {T.feed}
        </button>
        <span className="text-[12.5px] text-ink-500">{T.call}</span>
      </div>

      {/* Crew row */}
      <div className="flex shrink-0 flex-wrap justify-center gap-x-4 gap-y-3 px-6 pb-4 pt-6">
        {roles.map((r) => (
          <Seat key={r} role={r} mood={moods[r] ?? "idle"} />
        ))}
      </div>

      {/* Captions */}
      <div ref={captions} className="aide-scroll mx-auto min-h-0 w-full max-w-[720px] flex-1 space-y-3 overflow-y-auto px-6 py-3" aria-live="polite">
        {call.lines.map((line, i) => (
          <div key={i} className={line.who === "ceo" ? "text-right" : ""}>
            <div className="mb-0.5 text-[11.5px] uppercase tracking-wide text-ink-500">{line.who === "ceo" ? T.you : ROLE_BY_ID[line.who].name[l]}</div>
            <div
              className={
                "inline-block max-w-[85%] rounded-lg px-3 py-2 text-left text-[14.5px] leading-6 " +
                (line.who === "ceo" ? "bg-teal-300/10 text-ink-50" : "bg-white/[0.05] text-ink-100")
              }
            >
              <div className="whitespace-pre-wrap">{line.text}</div>
              {line.tools && line.tools.length > 0 && (
                <div className="mt-2 space-y-1 border-t border-white/[0.08] pt-1.5 text-[12px] font-mono text-teal-300/90">
                  {line.tools.slice(-4).map((t, ti) => (
                    <div key={ti} className="truncate">{t}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {note && <p className="text-[12.5px] text-ink-500">{note}</p>}
      </div>

      {/* Controls */}
      <div className="mx-auto mb-5 mt-2 flex w-full max-w-[720px] items-center gap-2 px-6">
        <button
          onPointerDown={startTalk}
          onPointerUp={endTalk}
          onPointerLeave={() => call.listening && endTalk()}
          aria-label={T.hint3}
          title={`${T.hint3} (Space)`}
          className={
            "flex size-11 shrink-0 items-center justify-center rounded-full border transition-colors " +
            (call.listening ? "border-teal-300 bg-teal-300 text-canvas" : "border-line-strong bg-raised text-ink-200 hover:bg-white/[0.08]")
          }
        >
          <Mic size={18} />
        </button>
        <div className="flex h-11 min-w-0 flex-1 items-center gap-1 rounded-xl border border-line-strong bg-raised px-3">
          <input
            value={draft}
            maxLength={1000}
            placeholder={T.typeHint}
            disabled={call.busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim()) {
                void say(draft);
                setDraft("");
              }
            }}
            className="h-8 min-w-0 flex-1 bg-transparent text-[14px] text-ink-100 outline-none placeholder:text-ink-500"
          />
          <button
            aria-label={T.send}
            disabled={call.busy || !draft.trim()}
            onClick={() => {
              void say(draft);
              setDraft("");
            }}
            className="aide-icon-button size-8 disabled:opacity-40"
          >
            <Send size={15} />
          </button>
        </div>
        <button
          aria-label={call.muted ? T.unmute : T.mute}
          title={call.muted ? T.unmute : T.mute}
          onClick={() => {
            stopSpeaking();
            useKins.getState().setCall({ muted: !call.muted });
          }}
          className="aide-icon-button size-11"
        >
          {call.muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
        </button>
        <button
          aria-label={T.leaveCall}
          title={T.leaveCallHint}
          onClick={leaveCall}
          className="flex h-11 items-center gap-1.5 rounded-xl border border-line-strong bg-raised px-3.5 text-[13px] font-medium text-ink-200 transition-colors hover:bg-white/[0.08] hover:text-ink-50"
        >
          <LogOut size={16} />
          <span>{T.leaveCall}</span>
        </button>
        <button
          aria-label={T.hangUp}
          title={T.startWorkFromCall}
          onClick={hangUpAndStartWork}
          className="flex h-11 items-center gap-1.5 rounded-xl bg-teal-400/90 px-3.5 text-[13px] font-medium text-canvas transition-[filter] hover:brightness-110"
        >
          <Play size={15} fill="currentColor" />
          <span>{T.hangUp}</span>
        </button>
      </div>
    </div>
  );
}
