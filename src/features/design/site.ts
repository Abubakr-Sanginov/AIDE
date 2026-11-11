import { invoke } from "@tauri-apps/api/core";

// "Site as an example": the backend downloads ONE public page (see
// src-tauri/src/web_fetch.rs: SSRF-protected, size and time limited). Here the page is
// reduced to a compact design brief (palette, fonts, radii, structure) for the model.
// The downloaded page is never rendered or executed; it is parsed inertly with
// DOMParser and only a short text summary is kept.

export interface SiteSnapshot {
  finalUrl: string;
  html: string;
  stylesheets: { url: string; css: string }[];
}

export interface SiteBrief {
  /** Short name of the site, used for screen names. */
  name: string;
  url: string;
  /** The text handed to the model. */
  text: string;
}

export function normalizeUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".") && !/^\[.*\]$/.test(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** `html` is the page source pasted by the user (for sites that refuse automatic downloads). */
export async function fetchSite(url: string, html?: string): Promise<SiteSnapshot> {
  return invoke<SiteSnapshot>("fetch_site", { url, html: html?.trim() ? html : null });
}

/* ── colors ─────────────────────────────────────────────── */

function toHex(token: string): string | null {
  const t = token.trim().toLowerCase();
  let m = t.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    return `#${h.slice(0, 6)}`;
  }
  m = t.match(/^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/);
  if (m) {
    const c = [m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)));
    return `#${c.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  }
  m = t.match(/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/);
  if (m) {
    const h = Number(m[1]) / 360;
    const s = Number(m[2]) / 100;
    const l = Number(m[3]) / 100;
    const f = (n: number) => {
      const k = (n + h * 12) % 12;
      const a = s * Math.min(l, 1 - l);
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return `#${[f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
  }
  return null;
}

const COLOR_TOKEN = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi;

function top<T extends string>(counts: Map<T, number>, n: number): T[] {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

function bump<T extends string>(map: Map<T, number>, key: T) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/* ── brief ──────────────────────────────────────────────── */

const SKIP_TAGS = new Set(["script", "style", "noscript", "template", "iframe", "link", "meta", "head", "svg", "path", "canvas"]);
const TEXT_TAGS = new Set(["h1", "h2", "h3", "h4", "a", "button", "p", "li", "label", "figcaption", "span", "strong", "em", "th", "td"]);
const MAX_OUTLINE_LINES = 170;
const MAX_OUTLINE_CHARS = 9000;

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function label(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const cls = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 2).join(".");
  return cls ? `${tag}.${cls.slice(0, 40)}` : tag;
}

function ownText(el: Element): string {
  return Array.from(el.childNodes)
    .filter((n) => n.nodeType === 3)
    .map((n) => n.textContent ?? "")
    .join(" ");
}

function outline(doc: Document): string {
  const lines: string[] = [];
  let chars = 0;
  const push = (depth: number, text: string) => {
    if (lines.length >= MAX_OUTLINE_LINES || chars >= MAX_OUTLINE_CHARS) return;
    const line = `${"  ".repeat(depth)}${text}`;
    lines.push(line);
    chars += line.length;
  };
  const walk = (el: Element, depth: number) => {
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag) || depth > 6) return;
    const kids = Array.from(el.children).filter((c) => !SKIP_TAGS.has(c.tagName.toLowerCase()));
    const text = clip(ownText(el), 70) || (TEXT_TAGS.has(tag) && kids.length === 0 ? clip(el.textContent ?? "", 70) : "");
    const interesting = text || kids.length > 0 || tag === "img" || tag === "input" || tag === "button";
    if (!interesting) return;
    if (tag === "img") {
      push(depth, `img${el.getAttribute("alt") ? ` alt="${clip(el.getAttribute("alt") ?? "", 40)}"` : ""}`);
      return;
    }
    if (tag === "input") {
      push(depth, `input[${el.getAttribute("type") ?? "text"}] ${clip(el.getAttribute("placeholder") ?? "", 40)}`.trim());
      return;
    }
    push(depth, `${label(el)}${text ? `: ${text}` : ""}`);
    // Collapse runs of similar siblings (cards, list items) after the first two.
    let similar = 0;
    let lastSig = "";
    for (const k of kids) {
      const sig = label(k);
      if (sig === lastSig) {
        similar++;
        if (similar >= 2) continue;
      } else {
        if (similar >= 2) push(depth + 1, `… ${similar - 1} more like the previous`);
        similar = 0;
        lastSig = sig;
      }
      walk(k, depth + 1);
    }
    if (similar >= 2) push(depth + 1, `… ${similar - 1} more like the previous`);
  };
  if (doc.body) walk(doc.body, 0);
  return lines.join("\n");
}

export function buildSiteBrief(snap: SiteSnapshot): SiteBrief {
  const doc = new DOMParser().parseFromString(snap.html.slice(0, 1_500_000), "text/html");
  let host = "site";
  try {
    host = new URL(snap.finalUrl).hostname.replace(/^www\./, "");
  } catch {
    /* pasted source without an address: keep the default */
  }
  const title = clip(doc.title || "", 60);
  const name = clip(title.split(/[|\-–—·:]/)[0] || host, 28) || host;
  const description = clip(doc.querySelector('meta[name="description"]')?.getAttribute("content") ?? "", 160);

  // All CSS: linked stylesheets plus inline <style> blocks.
  const inline = Array.from(doc.querySelectorAll("style")).map((s) => s.textContent ?? "");
  const css = [...snap.stylesheets.map((s) => s.css), ...inline].join("\n").slice(0, 2_500_000);

  const colors = new Map<string, number>();
  for (const m of css.matchAll(COLOR_TOKEN)) {
    const hex = toHex(m[0]);
    if (hex) bump(colors, hex);
  }
  const vars: string[] = [];
  for (const m of css.matchAll(/(--[\w-]{1,40})\s*:\s*([^;}{]{1,60})[;}]/g)) {
    const hex = toHex(m[2].trim());
    if (hex && vars.length < 14 && !vars.some((v) => v.startsWith(m[1] + ":"))) vars.push(`${m[1]}: ${hex}`);
  }
  const fonts = new Map<string, number>();
  for (const m of css.matchAll(/font-family\s*:\s*([^;}{]{1,200})/gi)) {
    const first = m[1].split(",")[0].trim().replace(/^["']|["']$/g, "");
    if (first && !/^(var\(|inherit|initial|unset|-apple-system|system-ui|sans-serif|serif|monospace)/i.test(first)) bump(fonts, first);
  }
  const radii = new Map<string, number>();
  for (const m of css.matchAll(/border-radius\s*:\s*([\d.]+(?:px|rem|em|%))/gi)) bump(radii, m[1]);
  const widths = new Map<string, number>();
  for (const m of css.matchAll(/max-width\s*:\s*(\d{3,4}px)/gi)) bump(widths, m[1]);
  const sizes = new Map<string, number>();
  for (const m of css.matchAll(/font-size\s*:\s*([\d.]+(?:px|rem))/gi)) bump(sizes, m[1]);

  const bodyRule = css.match(/(?:^|[}\s,])body\s*\{([^}]*)\}/i)?.[1] ?? "";
  const bodyBg = toHex(bodyRule.match(/background(?:-color)?\s*:\s*([^;]+)/i)?.[1]?.trim().split(/\s+/)[0] ?? "");
  const bodyFg = toHex(bodyRule.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i)?.[1]?.trim() ?? "");
  const hasShadows = /box-shadow\s*:/i.test(css);
  const hasGradients = /gradient\(/i.test(css);

  const nav = Array.from(doc.querySelectorAll("nav a, header a"))
    .map((a) => clip(a.textContent ?? "", 22))
    .filter(Boolean)
    .filter((t, i, all) => all.indexOf(t) === i)
    .slice(0, 8);

  const lines = [
    `Site: ${title || host} (${host})${doc.documentElement.lang ? `, lang=${doc.documentElement.lang}` : ""}`,
    description && `Description: ${description}`,
    colors.size > 0 && `Colors by frequency: ${top(colors, 12).join(", ")}`,
    vars.length > 0 && `Color variables: ${vars.join("; ")}`,
    (bodyBg || bodyFg) && `Page: background ${bodyBg ?? "?"}, text ${bodyFg ?? "?"}`,
    fonts.size > 0 && `Fonts: ${top(fonts, 4).map((f) => `"${f}"`).join(", ")}`,
    radii.size > 0 && `Corner radii: ${top(radii, 4).join(", ")}`,
    widths.size > 0 && `Container max-widths: ${top(widths, 3).join(", ")}`,
    sizes.size > 0 && `Common font sizes: ${top(sizes, 6).join(", ")}`,
    `Shadows: ${hasShadows ? "yes" : "no"}; gradients: ${hasGradients ? "yes" : "no"}`,
    nav.length > 0 && `Navigation: ${nav.join(" | ")}`,
    "",
    "Page structure (indented outline; the text is the page's own):",
    outline(doc),
  ].filter((l) => l !== false && l !== undefined) as string[];

  return { name, url: snap.finalUrl, text: lines.join("\n").slice(0, 16_000) };
}
