// Per-project storage keys. Keys mirrored to the Rust kv store may only contain
// [a-zA-Z0-9._-], so a project root is never embedded raw: it is normalized
// and reduced to a short FNV-1a hash.
export function normRoot(root: string | null | undefined): string {
  if (!root || !root.trim()) return "";
  return root.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function hashRoot(root: string | null | undefined): string {
  const s = normRoot(root);
  if (!s) return "";
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Storage key for a per-project value, e.g. keyFor("aide.chatHistory", root). */
export function keyFor(base: string, root: string | null | undefined): string {
  const h = hashRoot(root);
  return h ? `${base}.${h}` : base;
}

/** Root of the project that is open right now (the workspace store keeps it in storage). */
export function currentRoot(): string | null {
  try {
    return localStorage.getItem("aide.workspaceRoot") || null;
  } catch {
    return null;
  }
}

/** Two paths point at the same project when they normalize to the same string. */
export function sameRoot(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return normRoot(a) === normRoot(b);
}

/**
 * Key of a per-project value. A value saved before projects were separated lives
 * under the bare `base` key: it moves, once, to the first project that asks for it,
 * so it does not show up in every project afterwards.
 */
export function adoptLegacy(base: string, root: string | null | undefined): string {
  const key = keyFor(base, root);
  if (key === base) return key;
  try {
    if (localStorage.getItem(key) === null) {
      const legacy = localStorage.getItem(base);
      if (legacy !== null) {
        localStorage.setItem(key, legacy);
        localStorage.removeItem(base);
      }
    }
  } catch {
    /* storage unavailable: nothing to migrate */
  }
  return key;
}

/** Short storage-safe id of a project, the same one the backend uses for its file. */
export function projectScope(root: string | null | undefined): string {
  return hashRoot(root);
}
