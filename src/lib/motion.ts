import { flushSync } from "react-dom";
import type { StateCreator } from "zustand";

// Motion for the whole app.
//  * A preference (Settings → Appearance): "system" follows Windows "Animation effects", "on" always
//    animates, "off" never. It lives on <html data-motion> so the CSS can switch everything off.
//  * View transitions: switching a mode, panel or tab animates the region that changes (the browser
//    snapshots the old look and animates it into the new one). The regions are elements with an
//    `aide-vt-<region>` class; index.css decides how each region moves.

export type MotionPref = "system" | "on" | "off";
const PREF_KEY = "aide.motion";

export function getMotionPref(): MotionPref {
  try {
    const v = localStorage.getItem(PREF_KEY);
    return v === "on" || v === "off" ? v : "system";
  } catch {
    return "system";
  }
}

export function applyMotionPref(pref: MotionPref = getMotionPref()) {
  document.documentElement.dataset.motion = pref;
}

export function setMotionPref(pref: MotionPref) {
  try {
    localStorage.setItem(PREF_KEY, pref);
  } catch {
    /* storage unavailable: still applies for this session */
  }
  applyMotionPref(pref);
}

export function motionEnabled(): boolean {
  const pref = (document.documentElement.dataset.motion as MotionPref | undefined) ?? getMotionPref();
  if (pref === "off") return false;
  if (pref === "on") return true;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Which part of the window animates (matches the `.aide-vt-*` classes in index.css). */
export type VtRegion = "main" | "layout" | "vibe" | "settings" | "design" | "sidebar" | "right" | "dock" | "editor";
/** How it moves: slide forward/back, zoom in/out, or a plain rise-and-fade. */
export type VtDir = "next" | "prev" | "zoom" | "unzoom" | "fade";

interface ViewTransitionLike {
  ready: Promise<void>;
  finished: Promise<void>;
  updateCallbackDone: Promise<void>;
  skipTransition?: () => void;
}

/** The switch itself must never wait for an animation: if the browser cannot render a frame soon, skip it. */
const MAX_WAIT_MS = 400;
type DocWithVt = Document & { startViewTransition?: (update: () => void) => ViewTransitionLike };

// Bigger regions win when several updates land in the same tick (e.g. "open settings" also resets the mode).
const RANK: Record<VtRegion, number> = { main: 6, layout: 5, vibe: 4, settings: 3, design: 3, sidebar: 2, right: 2, dock: 2, editor: 1 };

let queue: (() => void)[] = [];
let queuedRegion: VtRegion | null = null;
let queuedDir: VtDir = "fade";
let scheduled = false;
let applying = false;
let seq = 0;

/**
 * Runs `update` (a state change) as an animated view transition of `region`.
 * Falls back to a plain update when motion is off, the window is hidden or the engine lacks the API.
 * Updates made in the same tick share one transition; updates made while one is being applied run directly.
 */
export function viewTransition(update: () => void, region: VtRegion, dir: VtDir = "fade") {
  const doc = document as DocWithVt;
  if (applying || typeof doc.startViewTransition !== "function" || document.hidden || !motionEnabled()) {
    update();
    return;
  }
  queue.push(update);
  if (!queuedRegion || RANK[region] > RANK[queuedRegion]) {
    queuedRegion = region;
    queuedDir = dir;
  }
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    const run = queue;
    const reg = queuedRegion ?? "main";
    const how = queuedDir;
    queue = [];
    queuedRegion = null;
    queuedDir = "fade";
    let applied = false;
    const apply = () => {
      if (applied) return; // already applied by the watchdog below
      applied = true;
      applying = true;
      try {
        flushSync(() => run.forEach((f) => f()));
      } finally {
        applying = false;
      }
    };
    const html = document.documentElement;
    const id = ++seq;
    html.dataset.vt = reg;
    html.dataset.vtDir = how;
    const cleanup = () => {
      if (id !== seq) return; // a newer transition owns the attributes now
      delete html.dataset.vt;
      delete html.dataset.vtDir;
    };
    let t: ViewTransitionLike;
    try {
      t = doc.startViewTransition!(apply);
    } catch {
      cleanup();
      run.forEach((f) => f());
      return;
    }
    // A skipped transition rejects these; the state change itself still happens.
    t.ready.catch(() => {});
    t.updateCallbackDone.catch(() => {});
    t.finished.then(cleanup, cleanup);
    // A transition that never finishes would leave its snapshot (a frozen or black frame) over the window.
    window.setTimeout(() => {
      try {
        t.skipTransition?.();
      } catch {
        /* already finished */
      }
      cleanup();
    }, 1500);
    // The browser calls `apply` only after it has painted the old look. A hidden or busy window may not
    // paint for a long time; then switch without the animation instead of making the click feel dead.
    const watchdog = window.setTimeout(() => {
      if (applied) return;
      try {
        t.skipTransition?.();
      } catch {
        /* already finished */
      }
      apply();
    }, MAX_WAIT_MS);
    t.updateCallbackDone.then(
      () => window.clearTimeout(watchdog),
      () => window.clearTimeout(watchdog),
    );
  });
}

type Pick<T> = (prev: T, next: Partial<T>) => { region: VtRegion; dir?: VtDir } | null;

/**
 * Zustand middleware: state changes that `pick` recognises (a view, tab or panel switch) are applied
 * inside a view transition; everything else (typing, resizing) is applied immediately as usual.
 */
export function withViewTransitions<T extends object>(pick: Pick<T>, config: StateCreator<T, [], []>): StateCreator<T, [], []> {
  return (set, get, api) => {
    type AnySet = (partial: unknown, replace?: boolean) => void;
    const raw = set as unknown as AnySet;
    const animated: AnySet = (partial, replace) => {
      const prev = get();
      const next = (typeof partial === "function" ? (partial as (s: T) => Partial<T>)(prev) : partial) as Partial<T> | null;
      const how = next && typeof next === "object" ? pick(prev, next) : null;
      if (!how) {
        raw(partial, replace);
        return;
      }
      // The partial is re-evaluated when applied, so a deferred toggle still flips the latest state.
      viewTransition(() => raw(partial, replace), how.region, how.dir);
    };
    api.setState = animated as unknown as typeof api.setState;
    return config(animated as unknown as typeof set, get, api);
  };
}

/** Direction of a move inside an ordered list of views: later = "next", earlier = "prev". */
export function dirOf<K>(order: readonly K[], from: K, to: K): VtDir {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a < 0 || b < 0 || a === b) return "fade";
  return b > a ? "next" : "prev";
}
