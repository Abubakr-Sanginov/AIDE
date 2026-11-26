export interface ToolEventKey {
  tool: string;
  args: string;
  status: string;
  iteration: number;
}

/**
 * A tool event either finishes a row that is already listed or adds a new one. Normally that row is the last one;
 * an agent that runs several tools at once (Qoder) may finish an earlier one, found by its number.
 */
export function mergeToolEvent<T extends ToolEventKey>(tools: readonly T[], event: T): T[] {
  const same = (x: T) => x.tool === event.tool && x.args === event.args;
  let at = tools.length - 1;
  if (at < 0 || !same(tools[at])) {
    for (at = tools.length - 1; at >= 0; at--) {
      if (same(tools[at]) && tools[at].iteration === event.iteration && tools[at].status === "running") break;
    }
  }
  if (at < 0) return [...tools, event];
  return tools.map((x, i) => (i === at ? event : x));
}
