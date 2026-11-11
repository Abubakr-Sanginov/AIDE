// What the user wants to hear about, and when. Pure logic plus a tiny localStorage wrapper.

export type NoticeKindId = "done" | "error" | "question" | "permission";

export interface NotifyPrefs {
  /** Per event: show anything at all (toast, title flash, system notification, sound). */
  kinds: Record<NoticeKindId, boolean>;
  /** Native system notification when the window is not in focus. */
  system: boolean;
  /** Beep when the window is not in focus. */
  sound: boolean;
  /** Quiet hours: no system notification and no sound (toasts in the window still appear). */
  quiet: boolean;
  quietFrom: number; // hour 0..23
  quietTo: number; // hour 0..23
}

export const DEFAULT_PREFS: NotifyPrefs = {
  kinds: { done: true, error: true, question: true, permission: true },
  system: true,
  sound: true,
  quiet: false,
  quietFrom: 22,
  quietTo: 8,
};

const KEY = "aide.notify";

const hour = (v: unknown, fallback: number) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 23 ? v : fallback);
const flag = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

/** Reads saved preferences; anything malformed falls back to the defaults field by field. */
export function parsePrefs(raw: string | null): NotifyPrefs {
  let data: Record<string, unknown> = {};
  try {
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (v && typeof v === "object" && !Array.isArray(v)) data = v as Record<string, unknown>;
  } catch {
    /* corrupt value: defaults */
  }
  const k = data.kinds && typeof data.kinds === "object" ? (data.kinds as Record<string, unknown>) : {};
  return {
    kinds: {
      done: flag(k.done, true),
      error: flag(k.error, true),
      question: flag(k.question, true),
      permission: flag(k.permission, true),
    },
    system: flag(data.system, true),
    sound: flag(data.sound, true),
    quiet: flag(data.quiet, false),
    quietFrom: hour(data.quietFrom, DEFAULT_PREFS.quietFrom),
    quietTo: hour(data.quietTo, DEFAULT_PREFS.quietTo),
  };
}

export function loadPrefs(): NotifyPrefs {
  try {
    return parsePrefs(localStorage.getItem(KEY));
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: NotifyPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: the choice lasts until restart */
  }
}

/** Is `h` (0..23) inside quiet hours? The range may wrap past midnight (22 → 8). Equal ends mean "all day". */
export function inQuietHours(p: Pick<NotifyPrefs, "quiet" | "quietFrom" | "quietTo">, h: number): boolean {
  if (!p.quiet) return false;
  if (p.quietFrom === p.quietTo) return true;
  return p.quietFrom < p.quietTo ? h >= p.quietFrom && h < p.quietTo : h >= p.quietFrom || h < p.quietTo;
}

export interface Plan {
  toast: boolean;
  system: boolean;
  sound: boolean;
}

/** What to do for an event: `focused` is whether the AIDE window is in focus right now. */
export function planNotice(p: NotifyPrefs, kind: NoticeKindId, hourNow: number, focused: boolean): Plan {
  if (!p.kinds[kind]) return { toast: false, system: false, sound: false };
  const loud = !focused && !inQuietHours(p, hourNow);
  return { toast: true, system: loud && p.system, sound: loud && p.sound };
}
