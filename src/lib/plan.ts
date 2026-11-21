export interface PlanStep {
  text: string;
  done: boolean;
}

const MAX_STEPS = 40;
const MAX_STEP_CHARS = 240;

/**
 * Steps of a plan the assistant wrote as markdown.
 *
 * Plan mode answers with a numbered or bulleted list; checkboxes are understood too, so a plan
 * that marks finished steps shows them as finished.
 */
export function parsePlan(markdown: string): PlanStep[] {
  const steps: PlanStep[] = [];
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    const m = /^(?:[-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.+)$/.exec(line);
    if (!m) continue;
    const text = m[2]
      .replace(/\*\*/g, "")
      .replace(/`/g, "")
      .trim();
    if (!text || text.length > MAX_STEP_CHARS) continue;
    steps.push({ text, done: (m[1] ?? "").toLowerCase() === "x" });
    if (steps.length >= MAX_STEPS) break;
  }
  return steps;
}

export interface AgentPlanStep extends PlanStep {
  /** The step being worked on right now. */
  active: boolean;
}

/**
 * The plan the agent wrote with its update_plan tool: lines "[x] text", "[~] text", "[ ] text" after a header line
 * (see plan_tool.rs). Anything else in the result is ignored, so a hand-made or garbled result gives no steps.
 */
export function parseAgentPlan(result: string): AgentPlanStep[] {
  const steps: AgentPlanStep[] = [];
  for (const raw of result.split("\n")) {
    const m = /^\[([ x~])\] (.+)$/.exec(raw.trim());
    if (!m) continue;
    steps.push({ text: m[2].slice(0, MAX_STEP_CHARS), done: m[1] === "x", active: m[1] === "~" });
    if (steps.length >= MAX_STEPS) break;
  }
  return steps;
}

interface WithTools {
  tools?: { tool: string; status: string; result: string }[];
}

/** The newest successful update_plan call of one message, or null. */
export function planOfTools(tools: WithTools["tools"]): AgentPlanStep[] | null {
  for (let i = (tools?.length ?? 0) - 1; i >= 0; i--) {
    const t = tools![i];
    if (t.tool === "update_plan" && t.status === "ok") {
      const steps = parseAgentPlan(t.result);
      if (steps.length > 0) return steps;
    }
  }
  return null;
}

/** The newest agent plan in the chat and the index of the message that holds it. */
export function latestAgentPlan(messages: readonly WithTools[]): { steps: AgentPlanStep[]; index: number } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const steps = planOfTools(messages[i].tools);
    if (steps) return { steps, index: i };
  }
  return null;
}
