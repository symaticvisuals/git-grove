import type { Finding, Rule } from "../rule.types.js";

export const unsafeMergedWorktree: Rule = {
  id: "unsafe-merged-worktree",
  evaluate: (ctx) => {
    const out: Finding[] = [];
    for (const [path, verdict] of ctx.removals) {
      if (verdict.ok) continue;
      out.push({
        rule: "unsafe-merged-worktree",
        severity: "loses-work",
        subject: { kind: "worktree", id: path },
        title: "Merged, but not safe to remove",
        detail: verdict.reasons.map((r) => r.detail).join("; "),
        action: `git grove check remove ${path}`,
      });
    }
    return out;
  },
};
