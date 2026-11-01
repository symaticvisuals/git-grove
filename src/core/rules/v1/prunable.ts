import type { Finding, Rule } from "../rule.types.js";

export const prunable: Rule = {
  id: "prunable",
  evaluate: (ctx) => {
    const out: Finding[] = [];
    for (const w of ctx.facts.worktrees) {
      if (!w.prunable) continue;
      out.push({
        rule: "prunable",
        severity: "needs-action",
        subject: { kind: "worktree", id: w.path },
        title: "Worktree folder is gone",
        detail: `${w.path} no longer exists on disk`,
        action: "git worktree prune",
      });
    }
    return out;
  },
};
