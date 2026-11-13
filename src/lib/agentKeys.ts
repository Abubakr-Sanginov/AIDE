import { isLoopbackUrl } from "./localProviders.ts";

/** "agent-" + a safe slug of the agent id; a number is added when that provider id is taken. */
export function providerIdFor(agentId: string, taken: readonly string[]): string {
  const slug = agentId.replace(/^found-/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28) || "agent";
  let id = `agent-${slug}`;
  for (let n = 2; taken.includes(id); n++) id = `agent-${slug}-${n}`.slice(0, 40);
  return id;
}

/** https, or http for a program on this computer; no credentials, query or fragment in the address. */
export function acceptableUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    if (u.username || u.password || u.search || u.hash) return null;
    if (u.protocol === "https:" || (u.protocol === "http:" && isLoopbackUrl(u.href))) return u;
  } catch {
    /* not an address */
  }
  return null;
}
