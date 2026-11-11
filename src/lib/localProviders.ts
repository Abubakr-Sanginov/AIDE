// Local models (Ollama, LM Studio, any "local-*" server): they run on the user's computer and need no API key.
// The Rust side (src-tauri/src/local_models.rs) treats the same ids as keyless, so keep the two rules in sync.

export type LocalServerId = "ollama" | "lmstudio";

export const LOCAL_DEFAULTS: Record<LocalServerId, string> = {
  ollama: "http://127.0.0.1:11434/v1",
  lmstudio: "http://127.0.0.1:1234/v1",
};

export const LOCAL_URLS_KEY = "aide.localUrls";

export function isLocalProvider(id: string): boolean {
  return id === "ollama" || id === "lmstudio" || id.startsWith("local-");
}

/** http://localhost, 127.x.x.x or [::1] — an address on this computer. */
export function isLoopbackUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    const h = u.hostname.toLowerCase();
    return u.protocol === "http:" && !u.username && !u.password && (h === "localhost" || h === "[::1]" || h === "::1" || /^127\.\d+\.\d+\.\d+$/.test(h));
  } catch {
    return false;
  }
}

/** A user-typed address → the OpenAI-compatible base URL (…/v1), or null when it is not on this computer. */
export function normalizeLocalUrl(raw: string): string | null {
  if (!isLoopbackUrl(raw)) return null;
  const u = new URL(raw.trim());
  if (u.search || u.hash) return null;
  const path = u.pathname.replace(/\/+$/, "");
  return `${u.origin}${path === "" ? "/v1" : path}`;
}

/** Saved address overrides (for a non-default port). Anything that is not a loopback address is dropped. */
export function parseLocalUrls(raw: string | null): Partial<Record<LocalServerId, string>> {
  if (!raw) return {};
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<Record<LocalServerId, string>> = {};
    for (const id of ["ollama", "lmstudio"] as const) {
      const v = data[id];
      const url = typeof v === "string" ? normalizeLocalUrl(v) : null;
      if (url) out[id] = url;
    }
    return out;
  } catch {
    return {};
  }
}

export interface LocalModelInfo {
  id: string;
  sizeBytes: number | null;
  params: string | null;
  quant: string | null;
  tools: boolean | null;
  /** Context length. When `contextRunning`, it is the one the model is running with (what the agent gets); else the model's maximum. */
  context: number | null;
  contextRunning: boolean;
  loaded: boolean;
}

/** Context length below which the AIDE agent (instructions + tools + files) does not fit. */
export const MIN_AGENT_CONTEXT = 8192;

export type ModelFit = "ok" | "no-tools" | "small-context" | "unknown";

/** Can this model run the agent? The agent calls tools, so a model without tool support is the first problem. */
export function modelFit(m: Pick<LocalModelInfo, "tools" | "context">): ModelFit {
  if (m.tools === false) return "no-tools";
  if (m.context != null && m.context < MIN_AGENT_CONTEXT) return "small-context";
  if (m.tools === null) return "unknown";
  return "ok";
}

const FIT_RANK: Record<ModelFit, number> = { ok: 0, unknown: 1, "small-context": 2, "no-tools": 3 };

/** Models that can run the agent first, then already loaded ones, then by name. */
export function sortLocalModels<T extends LocalModelInfo>(models: readonly T[]): T[] {
  return [...models].sort(
    (a, b) => FIT_RANK[modelFit(a)] - FIT_RANK[modelFit(b)] || Number(b.loaded) - Number(a.loaded) || a.id.localeCompare(b.id),
  );
}

export function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  const gb = bytes / 1_073_741_824;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1_048_576)} MB`;
}

export function formatContext(n: number | null): string {
  if (!n) return "";
  return n >= 1024 ? `${Math.round(n / 1024)}K` : String(n);
}

/** Context that AIDE's "bigger context" copy of an Ollama model gets. */
export const VARIANT_CONTEXT = 16384;

/** Name of the copy AIDE makes ("gemma4:12b-aide-16k"); the Rust side only deletes models with this shape. */
export function variantName(base: string, numCtx: number = VARIANT_CONTEXT): string {
  return `${base}-aide-${Math.floor(numCtx / 1024)}k`;
}

export function isAideVariant(id: string): boolean {
  return /^.+-aide-\d+k$/.test(id);
}

/**
 * Should Ollama model `m` offer the "16K context" button? Yes when it is a regular model that can use 16K,
 * has no copy yet, and is not already known to run with a 16K+ context.
 */
export function canMakeVariant(m: LocalModelInfo, all: readonly LocalModelInfo[], numCtx: number = VARIANT_CONTEXT): boolean {
  if (isAideVariant(m.id) || m.tools === false) return false;
  if (m.context != null && m.context < numCtx && !m.contextRunning) return false; // model itself cannot reach it
  if (m.contextRunning && m.context != null && m.context >= numCtx) return false; // already big enough
  return !all.some((x) => x.id === variantName(m.id, numCtx));
}
