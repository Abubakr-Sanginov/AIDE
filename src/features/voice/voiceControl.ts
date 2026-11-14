import { register, unregister, type ShortcutEvent } from "@tauri-apps/plugin-global-shortcut";
import { create } from "zustand";
import { appLang, isRuLike } from "@/i18n/ruLike";
import { hasWhisper, listenBest, refreshWhisper, type Listener } from "@/features/kins/voice";
import { hasComputerConsent } from "@/lib/computerMode";
import { notifySystem, playTone } from "@/lib/notify";
import { cleanCommand, hotkeyAction, loadVoicePrefs, type Action, type Phase } from "@/lib/voiceControl";
import { useAi } from "@/stores/ai";

// Voice control of the computer agent. A global hotkey (it works while another program is in front) starts the
// microphone; the phrase is recognised by Whisper (the Groq key from Settings → Voice; the backend holds the key) and
// sent to the agent in "Computer" mode after a short countdown during which pressing the hotkey cancels it.
// Safety: off by default, needs the Computer-mode consent, and the agent's own permission mode (ask / auto / free) still applies.

export type VoiceProblem = "" | "whisper" | "consent" | `taken:${string}`;

interface VoiceState {
  phase: Phase;
  /** The phrase waiting to be sent (countdown) or the last one. */
  text: string;
  registered: boolean;
  problem: VoiceProblem;
}

export const useVoiceControl = create<VoiceState>(() => ({ phase: "idle", text: "", registered: false, problem: "" }));
const set = (p: Partial<VoiceState>) => useVoiceControl.setState(p);

export const COUNTDOWN_MS = 3000;
const WATCHDOG_MS = 25_000;

let registeredKey: string | null = null;
let listener: Listener | null = null;
let down = false;
let pressedAt = 0;
let sendTimer: ReturnType<typeof setTimeout> | null = null;
let watchdog: ReturnType<typeof setTimeout> | null = null;

const ru = () => isRuLike(appLang());
const say = (title: string, body: string) => void notifySystem(title, body);

function clearTimers() {
  if (sendTimer) clearTimeout(sendTimer);
  if (watchdog) clearTimeout(watchdog);
  sendTimer = watchdog = null;
}

function toIdle() {
  clearTimers();
  listener = null;
  set({ phase: "idle", text: "" });
}

function startListening() {
  const lang = appLang() === "ru" || isRuLike(appLang()) ? "ru" : "en";
  const l = listenBest(
    lang,
    (phrase) => {
      if (useVoiceControl.getState().phase !== "working") return;
      const cmd = cleanCommand(phrase);
      if (!cmd) {
        say("AIDE", ru() ? "Не расслышал команду" : "Did not catch a command");
        return toIdle();
      }
      clearTimers();
      set({ phase: "countdown", text: cmd });
      playTone(660, 120);
      say(
        ru() ? "Голосовая команда" : "Voice command",
        ru() ? `«${cmd}»: выполню через 3 с. Нажмите горячую клавишу ещё раз, чтобы отменить.` : `“${cmd}”: running in 3 s. Press the hotkey again to cancel.`,
      );
      sendTimer = setTimeout(() => send(cmd), COUNTDOWN_MS);
    },
    (reason) => {
      say("AIDE", (ru() ? "Голос: " : "Voice: ") + reason.replace(/^stt:/, "").slice(0, 160));
      toIdle();
    },
  );
  if (!l) {
    say("AIDE", ru() ? "Микрофон недоступен" : "The microphone is not available");
    return;
  }
  listener = l;
  set({ phase: "listening", text: "" });
  playTone(880, 140);
}

function finishListening() {
  listener?.finish();
  set({ phase: "working" });
  playTone(520, 140);
  // No speech means no phrase and no callback: do not stay in "working" forever.
  watchdog = setTimeout(() => {
    if (useVoiceControl.getState().phase === "working") {
      say("AIDE", ru() ? "Не расслышал команду" : "Did not catch a command");
      toIdle();
    }
  }, WATCHDOG_MS);
}

function send(cmd: string) {
  const ai = useAi.getState();
  toIdle();
  if (!hasComputerConsent()) return say("AIDE", ru() ? "Сначала включите режим «Компьютер» в приложении" : "Turn on Computer mode in the app first");
  if (ai.streaming) return say("AIDE", ru() ? "Агент занят: команда не отправлена" : "The agent is busy: the command was not sent");
  ai.setMode("computer");
  void ai.send(cmd);
}

function act(a: Action) {
  if (a === "start") startListening();
  else if (a === "finish") finishListening();
  else if (a === "cancel-send") {
    toIdle();
    playTone(440, 160);
    say("AIDE", ru() ? "Команда отменена" : "Command canceled");
  }
}

function onShortcut(e: ShortcutEvent) {
  const phase = useVoiceControl.getState().phase;
  if (e.state === "Pressed") {
    const repeat = down; // the system repeats "pressed" while the keys are held
    down = true;
    if (!repeat) pressedAt = Date.now();
    act(hotkeyAction(phase, "pressed", 0, repeat));
  } else {
    down = false;
    act(hotkeyAction(phase, "released", Date.now() - pressedAt, false));
  }
}

/** (Re)registers the global hotkey according to the saved preferences. Safe to call again after any change. */
export async function applyVoiceControl(): Promise<void> {
  if (registeredKey) {
    try {
      await unregister(registeredKey);
    } catch {
      /* it was not registered any more */
    }
    registeredKey = null;
  }
  toIdle();
  set({ registered: false, problem: "" });
  const prefs = loadVoicePrefs();
  if (!prefs.enabled) return;
  // The browser's own recognizer is not reliable inside the app window: voice control needs the Whisper key.
  if (!(await refreshWhisper()) || !hasWhisper()) return set({ problem: "whisper" });
  if (!hasComputerConsent()) return set({ problem: "consent" });
  try {
    await register(prefs.hotkey, onShortcut);
    registeredKey = prefs.hotkey;
    set({ registered: true });
  } catch (e) {
    set({ problem: `taken:${String(e).slice(0, 120)}` });
  }
}
