import type { Finding, Rule } from "../rule.types.js";

export const parentMerged: Rule = {
  id: "parent-merged",
  evaluate: (ctx) => {
    const out: Finding[] = [];
    for (const feature of ctx.features) {
      for (const level of feature.levels) {
        if (!level.parentMerged && !level.parentMissing) continue;
        out.push({
          rule: "parent-merged",
          severity: "needs-action",
          subject: { kind: "level", id: `${feature.name}/${level.branch}` },
          title: level.parentMerged ? "Parent merged" : "Parent gone",
          detail: `${level.parent} is ${level.parentMerged ? "merged into" : "no longer present on"} ${ctx.facts.trunk.name}`,
          action: `re-base onto ${ctx.facts.trunk.name}`,
        });
      }
    }
    return out;
  },
};
