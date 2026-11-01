import type { Finding, Rule } from "../rule.types.js";

export const operationInProgress: Rule = {
  id: "operation-in-progress",
  evaluate: (ctx) => {
    const out: Finding[] = [];
    for (const w of ctx.facts.worktrees) {
      if (w.operation === null) continue;
      out.push({
        rule: "operation-in-progress",
        severity: "needs-action",
        subject: { kind: "worktree", id: w.path },
        title: `${w.operation} in progress`,
        detail: `${w.path} has an unfinished ${w.operation}`,
        action: `finish or abort the ${w.operation} in ${w.path}`,
      });
    }
    return out;
  },
};
