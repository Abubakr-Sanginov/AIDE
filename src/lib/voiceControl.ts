// Voice control of the computer agent: a global hotkey starts the microphone, the phrase is recognised and sent to the
// agent in "Computer" mode. Pure helpers live here (preferences, cleaning a phrase, push-to-talk or toggle); the
// side effects (hotkey, microphone, sending) are in features/voice/voiceControl.ts.

// Ctrl+Alt+Space and Ctrl+Alt+M are often taken by other programs (checked: they were on a real computer), so the defaults avoid them.
export const HOTKEYS = ["Ctrl+Shift+Space", "F9", "Ctrl+Shift+F9", "Ctrl+Alt+Space", "Ctrl+Alt+M"] as const;
export type Hotkey = (typeof HOTKEYS)[number];

export interface VoicePrefs {
  enabled: boolean;
  hotkey: Hotkey;
}

export const DEFAULT_VOICE_PREFS: VoicePrefs = { enabled: false, hotkey: "Ctrl+Shift+Space" };

const KEY = "aide.voiceControl";

/** Saved preferences; anything malformed falls back to the defaults field by field (only listed hotkeys are accepted). */
export function parseVoicePrefs(raw: string | null): VoicePrefs {
  try {
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      return {
        enabled: o.enabled === true,
        hotkey: (HOTKEYS as readonly string[]).includes(String(o.hotkey)) ? (o.hotkey as Hotkey) : DEFAULT_VOICE_PREFS.hotkey,
      };
    }
  } catch {
    /* corrupt value: defaults */
  }
  return DEFAULT_VOICE_PREFS;
}

export function loadVoicePrefs(): VoicePrefs {
  try {
    return parseVoicePrefs(localStorage.getItem(KEY));
  } catch {
    return DEFAULT_VOICE_PREFS;
  }
}

export function saveVoicePrefs(p: VoicePrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: the choice lasts until restart */
  }
}

const FILLER = /^(э+|а+|м+|ну|угу|ага|хм+|ммм+|uh+|um+|hm+|ok|ок)$/i;
export const MAX_COMMAND = 500;

/** A recognised phrase made ready for the agent: spaces collapsed, cut to a sensible length; null when it is not a command. */
export function cleanCommand(text: string): string | null {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length < 3) return null;
  const words = t.toLowerCase().replace(/[.,!?…]/g, "").split(" ").filter(Boolean);
  if (words.length === 0 || words.every((w) => FILLER.test(w))) return null;
  return t.slice(0, MAX_COMMAND);
}

/** Held for this long = push-to-talk (releasing the keys ends the recording); a shorter tap = toggle (press again to end). */
export const HOLD_MS = 600;

export type KeyEvent = "pressed" | "released";
export type Phase = "idle" | "listening" | "working" | "countdown";
export type Action = "start" | "finish" | "cancel-send" | "none";

/**
 * What a hotkey event does. `heldMs` is how long the keys were held when they were released.
 * idle + press → start; listening + release after a long hold → finish (push-to-talk);
 * listening + press (a second tap) → finish (toggle); countdown + press → cancel the pending send; everything else is ignored
 * (the operating system repeats "pressed" while keys are held).
 */
export function hotkeyAction(phase: Phase, ev: KeyEvent, heldMs: number, repeatPress: boolean): Action {
  if (ev === "pressed") {
    if (repeatPress) return "none";
    if (phase === "idle") return "start";
    if (phase === "listening") return "finish";
    if (phase === "countdown") return "cancel-send";
    return "none";
  }
  return phase === "listening" && heldMs >= HOLD_MS ? "finish" : "none";
}
