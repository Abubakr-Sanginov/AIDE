import { invoke } from "@tauri-apps/api/core";

// Agent skills (SKILL.md). All network access, validation and file writes happen in Rust
// (src-tauri/src/skills.rs, skills_remote.rs); the UI only passes identifiers.

export type SkillScope = "builtin" | "global" | "project";

export interface InstalledSkill {
  id: string;
  name: string;
  description: string;
  source: string;
  scope: SkillScope;
  enabled: boolean;
  removable: boolean;
  files: string[];
  size: number;
}

export interface CatalogHit {
  source: string;
  skillId: string;
  name: string;
  installs: number;
}

export interface SkillPreview {
  source: string;
  skillId: string;
  name: string;
  description: string;
  body: string;
  path: string;
  sha: string;
  files: string[];
  skipped: number;
}

export const skillsApi = {
  list: () => invoke<InstalledSkill[]>("skills_list"),
  setEnabled: (id: string, enabled: boolean) => invoke<void>("skills_set_enabled", { id, enabled }),
  read: (id: string) => invoke<string>("skills_read", { id }),
  remove: (id: string) => invoke<void>("skills_remove", { id }),
  search: (query: string) => invoke<CatalogHit[]>("skills_search", { query }),
  parseInput: (input: string) => invoke<{ source: string; skillId: string | null }>("skills_parse_input", { input }),
  repo: (source: string) => invoke<{ skillId: string; path: string }[]>("skills_repo", { source }),
  preview: (source: string, skillId: string) => invoke<SkillPreview>("skills_preview", { source, skillId }),
  install: (source: string, skillId: string, scope: "global" | "project") =>
    invoke<string>("skills_install", { source, skillId, scope }),
};

/** Looks like a link, `owner/repo[/skill]` or an `npx skills add …` command rather than a search query. */
export function looksLikeSource(input: string): boolean {
  const s = input.trim();
  return /^https?:\/\//i.test(s) || /^npx\s/i.test(s) || /^[\w.-]+\/[\w.-]+(\/[\w.-]+)?$/.test(s);
}
