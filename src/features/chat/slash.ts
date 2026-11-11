import { fs } from "@/api/fs";
import { joinPath } from "@/lib/fsUtils";
import { useWorkspace } from "@/stores/workspace";

export interface SlashItem {
  /** Name without the slash. */
  name: string;
  desc: string;
  source: "builtin" | "project" | "skill";
  /** "builtin": an action id handled by the chat; "project": a prompt template. */
  action?: "new" | "clear" | "chat" | "plan" | "agent";
  /** Prompt text for "project" commands and the preset prompts (`$ARGUMENTS` is replaced by what follows the name). */
  prompt?: string;
}

const MAX_FILE_CHARS = 20_000;
const NAME_RE = /^[\p{L}\p{N}_-]{1,40}$/u;

/** Project commands: every `.aide/commands/<name>.md` is a prompt template. Read-only, inside the open folder. */
export async function loadProjectCommands(): Promise<SlashItem[]> {
  const root = useWorkspace.getState().root;
  if (!root) return [];
  try {
    const dir = joinPath(joinPath(root, ".aide"), "commands");
    const entries = await fs.listDir(dir);
    const out: SlashItem[] = [];
    for (const e of entries.slice(0, 60)) {
      if (e.is_dir || !/\.md$/i.test(e.name)) continue;
      const name = e.name.replace(/\.md$/i, "");
      if (!NAME_RE.test(name)) continue;
      const body = (await fs.readFile(joinPath(dir, e.name))).slice(0, MAX_FILE_CHARS);
      const first = body.split("\n").find((l) => l.trim() && !l.startsWith("---"))?.replace(/^#+\s*/, "").trim() ?? "";
      out.push({ name, desc: first.slice(0, 80), source: "project", prompt: body });
    }
    return out;
  } catch {
    return []; // no such folder: nothing to offer
  }
}

/** Subsequence match, case-insensitive. Returns matched indices of `name` or null. */
export function fuzzy(query: string, name: string): number[] | null {
  const q = query.toLowerCase();
  const n = name.toLowerCase();
  if (!q) return [];
  const idx: number[] = [];
  let from = 0;
  for (const ch of q) {
    const i = n.indexOf(ch, from);
    if (i < 0) return null;
    idx.push(i);
    from = i + 1;
  }
  return idx;
}

/** Lower is better: prefix, then word start, then contiguous, then scattered. */
export function rank(positions: number[], name: string): number {
  if (positions.length === 0) return 0;
  if (positions[0] === 0 && positions.every((p, i) => p === i)) return 0;
  if (name.toLowerCase().includes(name.toLowerCase().slice(positions[0], positions[0] + positions.length)) && positions.every((p, i) => p === positions[0] + i)) return 1 + positions[0] / 100;
  return 2 + positions[positions.length - 1] / 100;
}

export function filterItems(items: SlashItem[], query: string): { item: SlashItem; hit: number[] }[] {
  const out: { item: SlashItem; hit: number[]; score: number }[] = [];
  for (const item of items) {
    const hit = fuzzy(query, item.name);
    if (hit) out.push({ item, hit, score: rank(hit, item.name) });
  }
  return out.sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name)).map(({ item, hit }) => ({ item, hit }));
}

export function fillPrompt(template: string, args: string): string {
  return template.includes("$ARGUMENTS") ? template.split("$ARGUMENTS").join(args) : args ? `${template}\n\n${args}` : template;
}

/** A skill added in Settings becomes a command: its instructions go with the request, the text after the name is the task. */
export function skillCommands(
  skills: { name: string; description: string; instructions: string; builtin: boolean }[],
  taken: Set<string>,
): SlashItem[] {
  const out: SlashItem[] = [];
  for (const sk of skills) {
    if (sk.builtin || !sk.instructions.trim()) continue;
    const name = sk.name.trim().toLowerCase().replace(/[^\p{L}\p{N}_:-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    if (!name || taken.has(name) || out.some((o) => o.name === name)) continue;
    out.push({
      name,
      desc: (sk.description || sk.name).slice(0, 90),
      source: "skill",
      prompt: `Use the skill "${sk.name}" for this task. Skill instructions:\n\n${sk.instructions.slice(0, 8000)}\n\n---\nTask: $ARGUMENTS`,
    });
  }
  return out;
}
