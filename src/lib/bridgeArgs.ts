import { cleanCss } from "../features/design/dom.ts";
import { joinPath } from "./fsUtils.ts";

// Validation of the arguments a model passes to the agent → interface bridge (see appBridge.ts).
// Kept free of stores and Tauri so it can be tested on its own.

export class BridgeError extends Error {}

// A function declaration (not a const arrow): only then does TypeScript narrow types after `fail(...)`.
export function fail(message: string): never {
  throw new BridgeError(message);
}

/** "color:#111;padding:16px" → { color, padding }; unknown shapes are dropped, values go through the CSS cleaner. */
export function parseStyles(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const i = part.indexOf(":");
    if (i < 1) continue;
    const key = part.slice(0, i).trim().toLowerCase();
    const value = cleanCss(part.slice(i + 1).trim()).slice(0, 300);
    if (/^-?[a-z][a-z-]{0,48}$/.test(key) && value) out[key] = value;
  }
  return out;
}

/** Relative project path → absolute one. Refuses anything that leaves the project. */
export function projectFile(root: string | null, rel: string): string {
  if (!root) return fail("Проект не открыт");
  const clean = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean || /^[a-zA-Z]:/.test(clean) || clean.split("/").some((p) => p === ".." || p === "")) {
    return fail("Путь должен быть внутри проекта и без «..»");
  }
  return joinPath(root, clean.split("/").join("\\"));
}
