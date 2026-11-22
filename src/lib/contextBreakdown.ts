// What fills the model window besides the conversation: the system prompt, tool definitions, MCP servers, skills,
// memory and project rules. The backend estimates those (context_breakdown); this file turns them into the segments
// of the bar in the Context panel.

export interface ContextBreakdown {
  systemPrompt: number;
  tools: number;
  toolsCount: number;
  mcpTools: number;
  mcpCount: number;
  mcpNames: string[];
  mcpInstructions: number;
  skills: number;
  skillsCount: number;
  memory: number;
  memoryFiles: { name: string; tokens: number }[];
}

/** The wire shape of the Rust command (snake_case) to the one used here. Anything odd becomes 0 / empty. */
export function parseBreakdown(raw: unknown): ContextBreakdown | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);
  const files = Array.isArray(o.memory_files)
    ? o.memory_files
        .filter((f): f is { name: string; tokens: number } => !!f && typeof (f as { name?: unknown }).name === "string")
        .map((f) => ({ name: String(f.name).slice(0, 80), tokens: n(f.tokens) }))
        .slice(0, 20)
    : [];
  const names = Array.isArray(o.mcp_names) ? o.mcp_names.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 80)).slice(0, 200) : [];
  return {
    systemPrompt: n(o.system_prompt),
    tools: n(o.tools),
    toolsCount: n(o.tools_count),
    mcpTools: n(o.mcp_tools),
    mcpCount: n(o.mcp_count),
    mcpNames: names,
    mcpInstructions: n(o.mcp_instructions),
    skills: n(o.skills),
    skillsCount: n(o.skills_count),
    memory: n(o.memory),
    memoryFiles: files,
  };
}

export type SegmentKey = "messages" | "tools" | "mcpTools" | "prompt" | "skills" | "mcpInstructions" | "memory" | "attachments";

export interface Segment {
  key: SegmentKey;
  tokens: number;
}

/** Order of the legend, largest groups of a typical session first. Empty groups are left out (messages always stays). */
export function buildSegments(b: ContextBreakdown | null, messages: number, attachments: number): Segment[] {
  const all: Segment[] = [
    { key: "messages", tokens: messages },
    { key: "tools", tokens: b?.tools ?? 0 },
    { key: "mcpTools", tokens: b?.mcpTools ?? 0 },
    { key: "prompt", tokens: b?.systemPrompt ?? 0 },
    { key: "skills", tokens: b?.skills ?? 0 },
    { key: "mcpInstructions", tokens: b?.mcpInstructions ?? 0 },
    { key: "memory", tokens: b?.memory ?? 0 },
    { key: "attachments", tokens: attachments },
  ];
  return all.filter((s) => s.tokens > 0 || s.key === "messages");
}

export function totalTokens(segments: readonly Segment[]): number {
  return segments.reduce((n, s) => n + s.tokens, 0);
}

/** "767", "18.2K", "23K", "623.4K", "1M". */
export function formatTokens(n: number): string {
  const v = Math.max(0, Math.round(n));
  const fmt = (x: number, unit: string) => `${x.toFixed(1).replace(/\.0$/, "")}${unit}`;
  if (v >= 1_000_000) return fmt(v / 1_000_000, "M");
  if (v >= 1_000) return fmt(v / 1_000, "K");
  return String(v);
}

/** Share of the window in percent, with one decimal below 10% so small groups do not all read "0%". */
export function formatShare(tokens: number, window: number): string {
  if (window <= 0) return "0%";
  const p = (tokens / window) * 100;
  return p >= 10 ? `${Math.round(p)}%` : `${p.toFixed(1)}%`;
}

/** Widths (percent of the bar) of the segments, scaled down when together they exceed the window. */
export function barWidths(segments: readonly Segment[], window: number): number[] {
  if (window <= 0) return segments.map(() => 0);
  const total = totalTokens(segments);
  const scale = total > window ? window / total : 1;
  return segments.map((s) => (s.tokens / window) * 100 * scale);
}
