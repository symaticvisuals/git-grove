import type { Finding, Rule } from "../rule.types.js";

const IDLE_MS = 14 * 86_400_000;

export const idle: Rule = {
  id: "idle",
  evaluate: (ctx) => {
    const out: Finding[] = [];
    for (const w of ctx.facts.worktrees) {
      if (w.isMain || w.touchedAt === null || ctx.now - w.touchedAt <= IDLE_MS) continue;
      const days = Math.floor((ctx.now - w.touchedAt) / 86_400_000);
      out.push({
        rule: "idle",
        severity: "idle",
        subject: { kind: "worktree", id: w.path },
        title: "Idle worktree",
        detail: `no change in ${days} days`,
        action: null,
      });
    }
    return out;
  },
};
