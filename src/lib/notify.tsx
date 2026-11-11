import { appLang, isRuLike } from "@/i18n/ruLike";
import { rt } from "@/i18n/tgMap";
import { useI18n } from "@/i18n";
import { useEffect } from "react";
import { create } from "zustand";
import { CheckCircle2, CircleAlert, CircleHelp, Download, ShieldQuestion } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { loadPrefs, planNotice } from "@/lib/notifyPrefs";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

// The agent may work while the user is elsewhere (another tab, another mode, another app).
// On finish / error / a clarifying question the user gets: an in-app toast, a flashing window
// title, a sound and — if permission is there — a system notification. Never silent.

export type NoticeKind = "done" | "error" | "question" | "permission" | "update";
export interface Notice {
  id: string;
  kind: NoticeKind;
  text: string;
}

interface Notices {
  list: Notice[];
  push: (n: Omit<Notice, "id">) => void;
  dismiss: (id: string) => void;
}

export const useNotices = create<Notices>((set) => ({
  list: [],
  push: (n) =>
    set((s) => ({ list: [...s.list, { id: crypto.randomUUID(), ...n }].slice(-5) })),
  dismiss: (id) => set((s) => ({ list: s.list.filter((x) => x.id !== id) })),
}));

let baseTitle = document.title;
let titleTimer: ReturnType<typeof setTimeout> | null = null;

function flashTitle(msg: string) {
  if (document.hasFocus()) return;
  if (!titleTimer) baseTitle = document.title;
  document.title = msg;
  const restore = () => {
    document.title = baseTitle;
    if (titleTimer) clearTimeout(titleTimer);
    titleTimer = null;
    window.removeEventListener("focus", restore);
  };
  window.addEventListener("focus", restore);
  if (titleTimer) clearTimeout(titleTimer);
  titleTimer = setTimeout(restore, 8000);
}

function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.value = 0.05;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    o.stop(ctx.currentTime + 0.4);
    void setTimeout(() => void ctx.close().catch(() => {}), 700);
  } catch {
    /* audio blocked: the toast is still there */
  }
}

async function systemNotify(title: string, body: string) {
  // Native OS notification (Windows toast and so on). The browser Notification API does not show anything in the app window.
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (granted) {
      sendNotification({ title, body: body.slice(0, 200) });
      return;
    }
  } catch {
    /* plugin unavailable (plain browser preview): fall back below */
  }
  try {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") new Notification(title, { body: body.slice(0, 200) });
    else if (Notification.permission === "default" && (await Notification.requestPermission()) === "granted") {
      new Notification(title, { body: body.slice(0, 200) });
    }
  } catch {
    /* unsupported (e.g. plain browser preview): toast still shows */
  }
}

export function agentNotice(kind: NoticeKind, text: string) {
  const ru = isRuLike(appLang());
  const title =
    kind === "done"
      ? ru ? rt("✔ Агент закончил") : "✔ Agent finished"
      : kind === "error"
        ? ru ? rt("✖ Ошибка агента") : "✖ Agent error"
        : kind === "permission"
          ? ru ? rt("🔒 Агенту нужно разрешение") : "🔒 Agent needs permission"
          : kind === "update"
            ? ru ? rt("Доступно обновление") : "Update available"
            : ru ? rt("? Агент спрашивает") : "? Agent asks";
  if (kind === "update") {
    // A new version is not an agent event: a toast in the window only, no sound and no system notification.
    useNotices.getState().push({ kind, text });
    return;
  }
  const plan = planNotice(loadPrefs(), kind, new Date().getHours(), document.hasFocus());
  if (plan.toast) {
    useNotices.getState().push({ kind, text });
    flashTitle(title);
  }
  if (plan.sound) beep();
  if (plan.system) void systemNotify(title, text);
}

/** "Send a test" button: a real system notification regardless of focus and of the quiet hours. */
export async function testNotification(title: string, body: string) {
  await systemNotify(title, body);
}

const ICONS = {
  done: CheckCircle2,
  error: CircleAlert,
  question: CircleHelp,
  permission: ShieldQuestion,
  update: Download,
} as const;

const TONE = {
  done: "text-emerald-300",
  error: "text-red-300",
  question: "text-amber-300",
  permission: "text-amber-300",
  update: "text-sky-300",
} as const;

export function AgentToasts() {
  const { lang } = useI18n();
  const ru = isRuLike(lang);
  const list = useNotices((s) => s.list);
  const dismiss = useNotices((s) => s.dismiss);

  // Toasts disappear on their own; the user can also close them by hand.
  useEffect(() => {
    if (list.length === 0) return;
    const last = list[list.length - 1];
    const id = setTimeout(() => dismiss(last.id), 6000);
    return () => clearTimeout(id);
  }, [list, dismiss]);

  if (list.length === 0) return null;
  return (
    <div className="aide-pop pointer-events-none fixed bottom-4 right-4 z-[130] flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {list.map((n) => {
        const Icon = ICONS[n.kind];
        return (
          <button
            key={n.id}
            onClick={() => {
              dismiss(n.id);
              void getCurrentWindow().unminimize().catch(() => {});
              void getCurrentWindow().setFocus().catch(() => {});
            }}
            className="pointer-events-auto flex items-start gap-2 rounded-2xl border border-line-strong bg-overlay p-3 text-left shadow-xl shadow-black/50"
          >
            <Icon size={15} className={`mt-0.5 shrink-0 ${TONE[n.kind]}`} />
            <span className="min-w-0 flex-1 text-[12.5px] leading-4 text-ink-100">
              <span className="block font-medium">
                {n.kind === "done"
                  ? ru ? rt("Агент закончил работу") : "Agent finished"
                  : n.kind === "error"
                    ? ru ? rt("Ошибка агента") : "Agent error"
                    : n.kind === "permission"
                      ? ru ? rt("Агенту нужно разрешение") : "Agent needs permission"
                      : n.kind === "update"
                        ? ru ? rt("Доступно обновление") : "Update available"
                        : ru ? rt("Агент задаёт вопрос") : "Agent asks"}
              </span>
              <span className="block truncate text-ink-300">{n.text}</span>
            </span>
            <span className="shrink-0 text-[11px] text-ink-500">✕</span>
          </button>
        );
      })}
    </div>
  );
}
