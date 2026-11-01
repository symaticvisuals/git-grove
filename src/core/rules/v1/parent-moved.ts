import { plural } from "../plural.js";
import type { Finding, Rule } from "../rule.types.js";

export const parentMoved: Rule = {
  id: "parent-moved",
  evaluate: (ctx) => {
    const out: Finding[] = [];
    for (const feature of ctx.features) {
      for (const level of feature.levels) {
        if (level.parentCommitsSinceFork <= 0 || level.parentMerged || level.parentMissing) continue;
        out.push({
          rule: "parent-moved",
          severity: "needs-action",
          subject: { kind: "level", id: `${feature.name}/${level.branch}` },
          title: "Parent moved",
          detail: `${level.parent} has ${plural(level.parentCommitsSinceFork, "commit")} not in ${level.branch}`,
          action: `restack ${level.branch} onto ${level.parent}`,
        });
      }
    }
    return out;
  },
};
