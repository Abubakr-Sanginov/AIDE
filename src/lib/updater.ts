import { check, type Update } from "@tauri-apps/plugin-updater";
import { getVersion } from "@tauri-apps/api/app";

// App updates. The backend plugin only installs packages signed with AIDE's own key (the public half is in
// tauri.conf.json) from the GitHub release address configured there, so nothing else can be installed from here.

export interface UpdateInfo {
  version: string;
  notes: string;
}

export type CheckResult = { state: "none" } | { state: "available"; info: UpdateInfo } | { state: "error"; message: string };

let pending: Update | null = null;

/** Newest release notes are untrusted text: shown as plain text only, and shortened. */
export function cleanNotes(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\s+\n/g, "\n").trim().slice(0, 600) : "";
}

export async function currentVersion(): Promise<string> {
  try {
    return await getVersion();
  } catch {
    return "";
  }
}

export async function checkForUpdate(): Promise<CheckResult> {
  try {
    const update = await check();
    if (!update) {
      pending = null;
      return { state: "none" };
    }
    pending = update;
    return { state: "available", info: { version: String(update.version).slice(0, 40), notes: cleanNotes(update.body) } };
  } catch (e) {
    return { state: "error", message: String(e).slice(0, 300) };
  }
}

/** Downloads and installs the update found by the last check. On Windows the app closes and the installer restarts it. */
export async function installUpdate(onProgress?: (done: number, total: number | null) => void): Promise<void> {
  if (!pending) throw new Error("no update");
  let done = 0;
  let total: number | null = null;
  await pending.downloadAndInstall((e) => {
    if (e.event === "Started") total = e.data.contentLength ?? null;
    else if (e.event === "Progress") {
      done += e.data.chunkLength;
      onProgress?.(done, total);
    }
  });
}

const LAST_KEY = "aide.updateCheck";
const DAY = 24 * 60 * 60 * 1000;

/** True when a background check is due (once a day); remembers the attempt. */
export function backgroundCheckDue(now = Date.now()): boolean {
  try {
    const last = Number(localStorage.getItem(LAST_KEY) ?? 0);
    if (Number.isFinite(last) && now - last < DAY) return false;
    localStorage.setItem(LAST_KEY, String(now));
  } catch {
    /* storage unavailable: check on every start, it is cheap */
  }
  return true;
}
