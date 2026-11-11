/** A project-relative path from the code index ("src/a/b.ts") → the full path in the style of the open project's root. */
export function absoluteFromIndex(root: string, rel: string): string {
  const sep = root.includes("\\") ? "\\" : "/";
  const base = root.replace(/[\\/]+$/, "");
  return `${base}${sep}${rel.split("/").filter(Boolean).join(sep)}`;
}

/** "5 s ago", "3 min ago" for the status line; `now` is injectable for tests. */
export function ageLabel(updatedAt: number, now: number, ru: boolean): string {
  if (!updatedAt) return "";
  const s = Math.max(0, Math.round((now - updatedAt) / 1000));
  if (s < 5) return ru ? "только что" : "just now";
  if (s < 60) return ru ? `${s} с назад` : `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return ru ? `${m} мин назад` : `${m} min ago`;
  const h = Math.round(m / 60);
  return ru ? `${h} ч назад` : `${h} h ago`;
}

/** Thousands separators for the counters: 12345 → "12 345". */
export function num(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
