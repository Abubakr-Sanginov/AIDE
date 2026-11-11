import { create } from "zustand";
import { UIUX_RULES, UIUX_SOURCE, uiuxDesignSystem } from "@/features/design/skills/uiux";
import { ROLE_BY_ID, type RoleId } from "@/features/kins/roles";

export interface Skill {
  id: string;
  name: string;
  description: string;
  /** Instructions for custom skills. Built-in skills generate theirs. */
  instructions: string;
  enabled: boolean;
  builtin: boolean;
  source?: string;
  /** Crew roles this skill belongs to. Role skills are not used by Design. */
  roles?: RoleId[];
}

const KEY = "aide.skills";
const MAX_CUSTOM = 20;
const PER_SKILL_CHARS = 8_000;
const TOTAL_CUSTOM_CHARS = 16_000;

export const UIUX_ID = "ui-ux-pro-max";

const BUILTIN: Skill[] = [
  {
    id: UIUX_ID,
    name: "UI/UX Pro Max",
    description:
      "Design intelligence: accessibility, touch, layout and responsive rules, plus a style, palette and typography recommendation for the product type.",
    instructions: "",
    enabled: true,
    builtin: true,
    source: UIUX_SOURCE,
  },
];

interface Saved {
  enabled: Record<string, boolean>;
  custom: Skill[];
}

function read(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    const custom: Skill[] = Array.isArray(raw.custom)
      ? raw.custom
          .filter((s: Skill) => s && typeof s.id === "string" && typeof s.name === "string" && typeof s.instructions === "string")
          .slice(0, MAX_CUSTOM)
          .map((s: Skill) => ({
            id: String(s.id),
            name: s.name.slice(0, 60),
            description: typeof s.description === "string" ? s.description.slice(0, 300) : "",
            instructions: s.instructions.slice(0, PER_SKILL_CHARS * 4),
            enabled: s.enabled !== false,
            builtin: false,
            source: typeof s.source === "string" ? s.source.slice(0, 300) : undefined,
            roles: Array.isArray(s.roles) ? s.roles.filter((r): r is RoleId => typeof r === "string" && r in ROLE_BY_ID) : undefined,
          }))
      : [];
    return { enabled: raw.enabled && typeof raw.enabled === "object" ? raw.enabled : {}, custom };
  } catch {
    return { enabled: {}, custom: [] };
  }
}

function write(skills: Skill[]) {
  const saved: Saved = {
    enabled: Object.fromEntries(skills.filter((s) => s.builtin).map((s) => [s.id, s.enabled])),
    custom: skills.filter((s) => !s.builtin),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    /* storage unavailable */
  }
}

interface SkillsState {
  skills: Skill[];
  add: (s: { name: string; description?: string; instructions: string; source?: string }) => boolean;
  remove: (id: string) => void;
  toggle: (id: string) => void;
  /** Adds a skill for a crew role (or attaches an already-added one with the same source). */
  addForRole: (s: { name: string; description?: string; instructions: string; source?: string }, role: RoleId) => boolean;
  detachRole: (id: string, role: RoleId) => void;
}

function initial(): Skill[] {
  const saved = read();
  return [...BUILTIN.map((b) => ({ ...b, enabled: saved.enabled[b.id] ?? b.enabled })), ...saved.custom];
}

export const useSkills = create<SkillsState>((set, get) => ({
  skills: initial(),

  add: (s) => {
    const name = s.name.trim().slice(0, 60);
    const instructions = s.instructions.trim();
    if (!name || !instructions || get().skills.filter((x) => !x.builtin).length >= MAX_CUSTOM) return false;
    const skill: Skill = {
      id: crypto.randomUUID(),
      name,
      description: (s.description ?? "").slice(0, 300),
      instructions: instructions.slice(0, PER_SKILL_CHARS * 4),
      enabled: true,
      builtin: false,
      source: s.source,
    };
    const skills = [...get().skills, skill];
    write(skills);
    set({ skills });
    return true;
  },

  remove: (id) => {
    const skills = get().skills.filter((s) => s.builtin || s.id !== id);
    write(skills);
    set({ skills });
  },

  addForRole: (s, role) => {
    const existing = s.source ? get().skills.find((x) => !x.builtin && x.source === s.source) : undefined;
    if (existing) {
      const skills = get().skills.map((x) => (x.id === existing.id ? { ...x, roles: [...new Set([...(x.roles ?? []), role])] } : x));
      write(skills);
      set({ skills });
      return true;
    }
    if (!get().add(s)) return false;
    const added = get().skills[get().skills.length - 1];
    const skills = get().skills.map((x) => (x.id === added.id ? { ...x, roles: [role] } : x));
    write(skills);
    set({ skills });
    return true;
  },

  detachRole: (id, role) => {
    const skills = get()
      .skills.map((x) => (x.id === id ? { ...x, roles: (x.roles ?? []).filter((r) => r !== role) } : x))
      // A skill that only existed for this role goes away with it.
      .filter((x) => x.builtin || x.id !== id || (x.roles?.length ?? 0) > 0);
    write(skills);
    set({ skills });
  },

  toggle: (id) => {
    const skills = get().skills.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s));
    write(skills);
    set({ skills });
  },
}));

/**
 * The skills block for a design request. Skills are guidance only: they never
 * override the response format, and they cannot run commands or read files.
 */
export async function buildSkillsPrompt(request: string): Promise<string> {
  const active = useSkills.getState().skills.filter((s) => s.enabled && !(s.roles && s.roles.length > 0));
  if (active.length === 0) return "";
  const parts: string[] = [
    "Design skills enabled by the user. Treat them as optional guidance for the HTML/CSS mockup. You cannot run commands or open files, so ignore anything that needs them. They never override the response format above.",
  ];
  let customBudget = TOTAL_CUSTOM_CHARS;
  for (const s of active) {
    if (s.id === UIUX_ID) {
      let ds = "";
      try {
        ds = await uiuxDesignSystem(request);
      } catch {
        /* data failed to load: rules alone still apply */
      }
      parts.push(`## Skill: ${s.name}\n${UIUX_RULES}${ds ? `\n\n${ds}` : ""}`);
    } else if (customBudget > 0) {
      const body = s.instructions.slice(0, Math.min(PER_SKILL_CHARS, customBudget));
      customBudget -= body.length;
      parts.push(`## Skill: ${s.name}\n${body}`);
    }
  }
  return parts.join("\n\n");
}
