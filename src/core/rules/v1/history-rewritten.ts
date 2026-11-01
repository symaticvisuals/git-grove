import type { Rule } from "../rule.types.js";

export const historyRewritten: Rule = {
  id: "history-rewritten",
  evaluate: (ctx) =>
    ctx.unresolved
      .filter((e) => e.kind === "rewritten")
      .map((e) => ({
        rule: "history-rewritten",
        severity: "loses-work",
        subject: { kind: "branch", id: e.branch },
        title: "History rewritten",
        detail: `${e.lost.length} commit(s) no longer on ${e.branch}${e.pinRef ? `, kept at ${e.pinRef}` : ""}`,
        action: `git grove restore ${e.branch}`,
      })),
};
