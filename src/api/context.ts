import { invoke } from "@tauri-apps/api/core";
import { parseBreakdown, type ContextBreakdown } from "@/lib/contextBreakdown";

export const contextApi = {
  /** What AIDE adds to the conversation in this mode (prompt, tools, MCP, skills, rules), estimated in tokens. */
  breakdown: async (mode: "plan" | "agent" | "computer" | "studio", compact: boolean): Promise<ContextBreakdown | null> =>
    parseBreakdown(await invoke<unknown>("context_breakdown", { mode, compact })),
};
