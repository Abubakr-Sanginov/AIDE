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
