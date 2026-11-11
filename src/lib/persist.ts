import { invoke } from "@tauri-apps/api/core";

// Durable app state. `localStorage` of the window can be lost (different launch,
// reset WebView profile), so every `aide.*` key is mirrored into a file in the app
// config directory (see src-tauri/src/kv_store.rs) and restored on startup.

const PREFIX = "aide.";
// Already persisted by the backend in its own file (one file per project).
const SKIP_PREFIXES = ["aide.chatHistory"];

type Changes = Record<string, string | null>;

function wanted(key: string): boolean {
  return (
    key.startsWith(PREFIX) &&
    !SKIP_PREFIXES.some((p) => key === p || key.startsWith(`${p}.`))
  );
}

async function save(changes: Changes): Promise<void> {
  if (Object.keys(changes).length === 0) return;
  try {
    await invoke("kv_save", { changes });
  } catch {
    /* not running inside Tauri, or the disk is unavailable: localStorage still works */
  }
}

/**
 * Call BEFORE any store is created (stores read localStorage when imported):
 * 1. keys missing from localStorage are restored from the file,
 * 2. keys only present in localStorage are written to the file,
 * 3. later writes are mirrored.
 */
export async function hydrateStorage(): Promise<void> {
  try {
    const stored = (await invoke<Record<string, string> | null>("kv_load")) ?? {};
    for (const [k, v] of Object.entries(stored)) {
      if (wanted(k) && localStorage.getItem(k) === null) localStorage.setItem(k, v);
    }
    const missing: Changes = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && wanted(k) && !(k in stored)) missing[k] = localStorage.getItem(k);
    }
    await save(missing);
  } catch {
    /* no backend (plain browser preview) */
  }
  installMirror();
}

let pending: Changes = {};
let timer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  if (timer) clearTimeout(timer);
  timer = null;
  const changes = pending;
  pending = {};
  void save(changes);
}

function queue(key: string, value: string | null) {
  if (!wanted(key)) return;
  pending[key] = value;
  if (!timer) timer = setTimeout(flush, 400);
}

let installed = false;

function installMirror() {
  if (installed) return;
  installed = true;
  const proto = Storage.prototype;
  const set = proto.setItem;
  const remove = proto.removeItem;
  proto.setItem = function (this: Storage, key: string, value: string) {
    set.call(this, key, value);
    if (this === window.localStorage) queue(key, String(value));
  };
  proto.removeItem = function (this: Storage, key: string) {
    remove.call(this, key);
    if (this === window.localStorage) queue(key, null);
  };
  // Do not lose the last 400 ms when the window closes.
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}
