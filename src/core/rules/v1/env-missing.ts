import type { Finding, Rule } from "../rule.types.js";

export const envMissing: Rule = {
  id: "env-missing",
  evaluate: (ctx) => {
    const out: Finding[] = [];
    for (const [path, files] of ctx.envMissing) {
      if (files.length === 0) continue;
      out.push({
        rule: "env-missing",
        severity: "needs-action",
        subject: { kind: "worktree", id: path },
        title: "Env files missing",
        detail: `${files.join(", ")} exist in the main worktree but not in ${path}`,
        action: `copy ${files.join(", ")} from the main worktree`,
      });
    }
    return out;
  },
};
