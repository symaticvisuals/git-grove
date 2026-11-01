import { sep } from "node:path";
import type { Rule } from "../rule.types.js";

export const nestedWorktree: Rule = {
  id: "nested-worktree",
  evaluate: (ctx) => {
    const paths = ctx.facts.worktrees.map((w) => w.path);
    return ctx.facts.worktrees.filter((w) => !w.isMain).map((w) => w.path).flatMap((outer) => {
      const inner = paths.filter((p) => p !== outer && p.startsWith(outer.endsWith(sep) ? outer : outer + sep));
      if (inner.length === 0) return [];
      return [
        {
          rule: "nested-worktree",
          severity: "needs-action" as const,
          subject: { kind: "worktree" as const, id: outer },
          title: "Worktree inside another worktree",
          detail: `contains ${inner.join(", ")}`,
          action: "move the inner worktree out with git worktree move",
        },
      ];
    });
  },
};
