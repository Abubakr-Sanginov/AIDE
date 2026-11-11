// Keep draft identifiers derived from the full name until the user edits them.
export function providerSlug(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return slug.length >= 2 ? slug : "custom";
}

export function validateCustomProvider<T extends { id: string; name: string; baseUrl: string; kind: string }>(
  cfg: T, existing: readonly { id: string }[],
): T {
  const id = cfg.id.trim();
  if (!/^[a-zA-Z0-9-]{2,40}$/.test(id)) throw new Error("provider-id");
  if (!cfg.name.trim() || cfg.name.trim().length > 120) throw new Error("provider-name");
  if (existing.some((p) => p.id.toLowerCase() === id.toLowerCase())) throw new Error("provider-duplicate");
  if (!["openai", "anthropic", "google"].includes(cfg.kind)) throw new Error("provider-kind");
  let url: URL;
  try { url = new URL(cfg.baseUrl.trim()); } catch { throw new Error("provider-url"); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("provider-url");
  }
  return { ...cfg, id, name: cfg.name.trim(), baseUrl: url.href.replace(/\/+$/, "") };
}
