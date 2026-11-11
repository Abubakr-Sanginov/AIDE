// Voice for the Kins call: browser speech APIs (no keys, no extra network code of ours).
// Availability depends on the WebView, so everything is feature-detected and the call
// always works through the text field as well.

import { invoke } from "@tauri-apps/api/core";

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const canListen = () => recognitionCtor() !== null;
export const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;

export interface Listener {
  /** Stops listening and delivers the recognized phrase. */
  finish: () => void;
  cancel: () => void;
}

export function listen(lang: string, onPhrase: (text: string) => void, onProblem: (reason: string) => void): Listener | null {
  const Ctor = recognitionCtor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = lang === "ru" ? "ru-RU" : "en-US";
  rec.interimResults = false;
  rec.continuous = true;
  let heard = "";
  let canceled = false;
  rec.onresult = (e) => {
    heard = Array.from(e.results)
      .map((r) => r[0]?.transcript ?? "")
      .join(" ")
      .trim();
  };
  rec.onerror = (e) => onProblem(e.error ?? "error");
  rec.onend = () => {
    if (!canceled && heard) onPhrase(heard.slice(0, 1000));
  };
  try {
    rec.start();
  } catch {
    return null;
  }
  return {
    finish: () => {
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    },
    cancel: () => {
      canceled = true;
      try {
        rec.abort();
      } catch {
        /* already stopped */
      }
    },
  };
}

/* ── Whisper (Groq): recorded in the app, transcribed by the backend. The key never reaches this code. ── */

let whisperReady = false;

export async function refreshWhisper(): Promise<boolean> {
  try {
    whisperReady = await invoke<boolean>("stt_has_key");
  } catch {
    whisperReady = false;
  }
  return whisperReady;
}

export const hasWhisper = () => whisperReady;
export const canTalk = () => (whisperReady ? !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined" : canListen());

function pickMime(): string {
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("read"));
    r.readAsDataURL(blob);
  });
}

function listenWhisper(lang: string, onPhrase: (text: string) => void, onProblem: (reason: string) => void): Listener | null {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return null;
  let canceled = false;
  let stopRequested = false;
  let rec: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  const chunks: Blob[] = [];
  const release = () => stream?.getTracks().forEach((t) => t.stop());
  const stop = () => {
    if (rec && rec.state !== "inactive") rec.stop();
  };

  navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then((s) => {
      stream = s;
      if (canceled) return release();
      const mime = pickMime();
      const r = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      rec = r;
      r.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      r.onstop = () => {
        release();
        if (canceled) return;
        const type = (r.mimeType || mime || "audio/webm").split(";")[0];
        void (async () => {
          try {
            const b64 = await toBase64(new Blob(chunks, { type }));
            const text = await invoke<string>("stt_transcribe", { audioB64: b64, mime: type, lang: lang === "ru" ? "ru" : "en" });
            if (!canceled && text.trim()) onPhrase(text.trim().slice(0, 1000));
          } catch (e) {
            onProblem("stt:" + String(e));
          }
        })();
      };
      r.start();
      if (stopRequested) stop();
    })
    .catch(() => onProblem("stt:Нет доступа к микрофону"));

  return {
    finish: () => {
      stopRequested = true;
      stop();
    },
    cancel: () => {
      canceled = true;
      stopRequested = true;
      stop();
      release();
    },
  };
}

/** Whisper when a Groq key is set, the browser's recognizer otherwise. */
export function listenBest(lang: string, onPhrase: (text: string) => void, onProblem: (reason: string) => void): Listener | null {
  return whisperReady ? listenWhisper(lang, onPhrase, onProblem) : listen(lang, onPhrase, onProblem);
}

const VOICE_BY_ROLE: Record<string, number> = {};

export function speak(text: string, lang: string, roleKey: string): Promise<void> {
  if (!canSpeak()) return Promise.resolve();
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const u = new SpeechSynthesisUtterance(text.slice(0, 600));
    u.lang = lang === "ru" ? "ru-RU" : "en-US";
    const voices = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith(u.lang.slice(0, 2)));
    if (voices.length > 0) {
      if (!(roleKey in VOICE_BY_ROLE)) VOICE_BY_ROLE[roleKey] = Object.keys(VOICE_BY_ROLE).length % voices.length;
      u.voice = voices[VOICE_BY_ROLE[roleKey]];
    }
    u.rate = 1.05;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    synth.speak(u);
  });
}

export function stopSpeaking() {
  if (canSpeak()) window.speechSynthesis.cancel();
}
