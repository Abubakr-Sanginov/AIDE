import { useState } from "react";
import { ArrowRight, CheckCircle2, Circle, Globe, Monitor, RefreshCw, Smartphone, Tablet, XCircle } from "lucide-react";
import { lang } from "./engine";
import { Avatar } from "./Avatar";
import { ROLE_BY_ID } from "./roles";
import { useKins, type SideTab } from "./store";
import { useKinsText } from "./strings";

type Device = "desktop" | "tablet" | "phone";
const WIDTH: Record<Device, number | "100%"> = { desktop: "100%", tablet: 768, phone: 390 };

/** Accepts "localhost:5173", "127.0.0.1:3000/x", "example.com" or a full http(s) URL. */
export function normalizePreviewUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw || raw.length > 2000) return null;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(raw);
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `${local ? "http" : "https"}://${raw}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.username || u.password) return null;
    if (!u.hostname.includes(".") && !/^(localhost|\[::1\])$/.test(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function Preview() {
  const T = useKinsText();
  const url = useKins((s) => s.previewUrl);
  const [draft, setDraft] = useState(url);
  const [device, setDevice] = useState<Device>("desktop");
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);

  const go = () => {
    const normalized = normalizePreviewUrl(draft);
    setError(!normalized);
    if (normalized) {
      useKins.getState().setPreviewUrl(normalized);
      setDraft(normalized);
    }
  };
  const devBtn = (d: Device, Icon: typeof Monitor) => (
    <button
      key={d}
      aria-pressed={device === d}
      aria-label={d}
      onClick={() => setDevice(d)}
      className="aide-icon-button size-8 aria-pressed:bg-white/[0.1] aria-pressed:text-ink-50"
    >
      <Icon size={15} />
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-2 pb-2">
        <div className={"flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border bg-white/[0.04] px-2.5 " + (error ? "border-red-500/60" : "border-line")}>
          <Globe size={14} className="shrink-0 text-ink-400" />
          <input
            value={draft}
            spellCheck={false}
            placeholder={T.urlPlaceholder}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(false);
            }}
            onKeyDown={(e) => e.key === "Enter" && go()}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink-100 outline-none placeholder:text-ink-500"
          />
          <button aria-label="Go" onClick={go} className="text-ink-400 hover:text-ink-50">
            <ArrowRight size={15} />
          </button>
        </div>
        <button aria-label="Reload" disabled={!url} onClick={() => setNonce((n) => n + 1)} className="aide-icon-button size-8 disabled:opacity-40">
          <RefreshCw size={14} />
        </button>
        {devBtn("desktop", Monitor)}
        {devBtn("tablet", Tablet)}
        {devBtn("phone", Smartphone)}
      </div>
      {error && <div className="px-3 pb-2 text-[12px] text-red-300">{T.badUrl}</div>}
      <div className="aide-scroll min-h-0 flex-1 overflow-auto rounded-xl bg-black/30 p-2">
        {url ? (
          <iframe
            key={url + nonce}
            title={T.preview}
            src={url}
            // Third-party pages stay isolated: own origin, no top navigation, no popups.
            sandbox="allow-scripts allow-same-origin allow-forms"
            referrerPolicy="no-referrer"
            className="mx-auto h-full min-h-[480px] rounded-lg bg-white"
            style={{ width: WIDTH[device] }}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-white/[0.05] text-ink-300">
              <Globe size={22} />
            </div>
            <div className="text-[14px] font-medium text-ink-100">{T.previewTitle}</div>
            <div className="text-[13px] text-ink-400">{T.previewHint}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function TeamTab() {
  const T = useKinsText();
  const roles = useKins((s) => s.roles());
  const active = useKins((s) => s.activeRole);
  const moods = useKins((s) => s.moods);
  const phase = useKins((s) => s.tasks.find((t) => t.id === s.activeId)?.phase ?? "idle");
  const l = lang();
  return (
    <div className="aide-scroll min-h-0 flex-1 space-y-1 overflow-y-auto px-2">
      {roles.map((id) => {
        const mood = moods[id] ?? (active === id ? (phase === "planning" ? "thinking" : phase === "verifying" ? "checking" : "working") : "idle");
        const busy = mood !== "idle";
        const status = mood === "thinking" ? T.thinkingNow : mood === "wants" ? T.wantsToSpeak : mood === "speaking" ? T.speakingNow : mood === "checking" ? T.checking : T.working;
        return (
          <div key={id} className="flex items-center gap-3 rounded-lg px-2 py-2">
            <Avatar role={id} size={32} mood={mood} />
            <div className="min-w-0 flex-1">
              <div className="text-[14px] text-ink-100">{ROLE_BY_ID[id].name[l]}</div>
              <div className="truncate text-[12.5px] text-ink-500">{busy ? status : ROLE_BY_ID[id].blurb[l]}</div>
            </div>
            {busy && <span className={"size-2 animate-pulse rounded-full " + (mood === "wants" ? "bg-amber-300" : "bg-accent")} />}
          </div>
        );
      })}
    </div>
  );
}

function ChecksTab() {
  const T = useKinsText();
  const checks = useKins((s) => s.tasks.find((t) => t.id === s.activeId)?.checks ?? []);
  if (checks.length === 0) return <div className="px-4 py-3 text-[13px] text-ink-500">{T.noChecks}</div>;
  return (
    <ul className="aide-scroll min-h-0 flex-1 space-y-1 overflow-y-auto px-2">
      {checks.map((c, i) => (
        <li key={i} className="flex items-start gap-2.5 rounded-lg px-2 py-2 text-[13.5px] text-ink-200">
          {c.status === "pass" ? (
            <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-400" />
          ) : c.status === "fail" ? (
            <XCircle size={15} className="mt-0.5 shrink-0 text-red-400" />
          ) : (
            <Circle size={15} className="mt-0.5 shrink-0 text-ink-600" />
          )}
          <span>{c.text}</span>
        </li>
      ))}
    </ul>
  );
}

export function KinsSidePanel() {
  const T = useKinsText();
  const tab = useKins((s) => s.sideTab);
  const tabs: { id: SideTab; label: string }[] = [
    { id: "preview", label: T.preview },
    { id: "team", label: T.team },
    { id: "checks", label: T.checks },
  ];
  return (
    <aside className="aide-island aide-panel-in-right mr-0 flex min-h-0 w-[420px] shrink-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 px-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            aria-pressed={tab === t.id}
            onClick={() => useKins.getState().setSide(true, t.id)}
            className="h-8 rounded-lg px-3 text-[14px] font-medium text-ink-400 transition-colors hover:text-ink-50 aria-pressed:bg-white/[0.07] aria-pressed:text-ink-50"
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "preview" ? <Preview /> : tab === "team" ? <TeamTab /> : <ChecksTab />}
    </aside>
  );
}
