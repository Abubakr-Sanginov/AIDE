// Imports skills (SKILL.md files) from a public GitHub repository.
//
// Only github.com / raw.githubusercontent.com / api.github.com are ever contacted
// (the CSP in tauri.conf.json enforces the same allowlist). The fetched text is
// UNTRUSTED instructions: it is size-limited, shown to the user before it is added,
// and always injected below the app's own output-format rules.

export interface RemoteSkill {
  path: string;
  name: string;
  description: string;
  instructions: string;
  url: string;
}

const SEG = /^[A-Za-z0-9._-]+$/;
const MAX_FILE_CHARS = 80_000;
const MAX_SKILLS = 12;

function seg(v: string | undefined): string {
  if (!v || !SEG.test(v)) throw new Error("Unsupported GitHub URL");
  return v;
}

async function getText(url: string, maxChars = MAX_FILE_CHARS * 2): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(url, { credentials: "omit", signal: ctrl.signal });
    if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
    const text = await res.text();
    if (text.length > maxChars) throw new Error("File is too large");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/** Splits YAML-ish front matter (name, description) from the body. */
export function parseSkillFile(raw: string, fallbackName: string): { name: string; description: string; body: string } {
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  const front = m?.[1] ?? "";
  const body = (m ? m[2] : raw).trim();
  const get = (key: string) => {
    const r = front.match(new RegExp(`^${key}:\\s*(.+)$`, "mi"));
    return r ? r[1].trim().replace(/^["']|["']$/g, "") : "";
  };
  return {
    name: (get("name") || fallbackName).slice(0, 60),
    description: get("description").slice(0, 300),
    body: body.slice(0, MAX_FILE_CHARS),
  };
}

function toSkill(path: string, raw: string, rawUrl: string): RemoteSkill {
  const folder = path.split("/").slice(-2, -1)[0] ?? "skill";
  const p = parseSkillFile(raw, folder);
  return { path, name: p.name, description: p.description, instructions: p.body, url: rawUrl };
}

/** Finds SKILL.md files for a repo / folder / file URL. */
export async function findSkills(input: string): Promise<RemoteSkill[]> {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Enter a GitHub URL");
  }
  if (url.protocol !== "https:") throw new Error("Only https URLs are supported");
  const parts = url.pathname.split("/").filter(Boolean);

  if (url.hostname === "raw.githubusercontent.com") {
    const [owner, repo, ref, ...rest] = parts;
    const path = rest.join("/");
    if (!path.toLowerCase().endsWith(".md")) throw new Error("Link to a SKILL.md file or a repository");
    seg(owner);
    seg(repo);
    seg(ref);
    rest.forEach(seg);
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`;
    return [toSkill(path, await getText(rawUrl), rawUrl)];
  }
  if (url.hostname !== "github.com") throw new Error("Only github.com links are supported");

  const owner = seg(parts[0]);
  const repo = seg(parts[1]?.replace(/\.git$/, ""));
  const kind = parts[2]; // blob | tree | undefined
  const ref = kind ? seg(parts[3]) : "HEAD";
  const sub = kind ? parts.slice(4) : [];
  sub.forEach(seg);
  const subPath = sub.join("/");

  if (kind === "blob") {
    if (!subPath.toLowerCase().endsWith(".md")) throw new Error("Link to a SKILL.md file or a repository");
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${subPath}`;
    return [toSkill(subPath, await getText(rawUrl), rawUrl)];
  }

  const tree = JSON.parse(await getText(`https://api.github.com/repos/${owner}/${repo}/git/trees/${ref}?recursive=1`, 4_000_000)) as {
    tree?: { path: string; type: string }[];
  };
  const files = (tree.tree ?? [])
    .filter((e) => e.type === "blob" && /(^|\/)SKILL\.md$/i.test(e.path) && (!subPath || e.path.startsWith(`${subPath}/`) || e.path === subPath))
    .map((e) => e.path)
    .filter((p) => p.split("/").every((s) => SEG.test(s)))
    // Repos often ship the same skill twice (e.g. under cli/assets): keep one per folder name, preferring .claude/.
    .sort((x, y) => Number(y.startsWith(".claude/")) - Number(x.startsWith(".claude/")))
    .filter((p, i, all) => all.findIndex((q) => q.split("/").slice(-2, -1)[0] === p.split("/").slice(-2, -1)[0]) === i)
    .slice(0, MAX_SKILLS);
  if (files.length === 0) throw new Error("No SKILL.md found in this repository");

  const out: RemoteSkill[] = [];
  for (const path of files) {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`;
    try {
      out.push(toSkill(path, await getText(rawUrl), rawUrl));
    } catch {
      /* skip unreadable files */
    }
  }
  if (out.length === 0) throw new Error("Could not read any SKILL.md");
  return out;
}
