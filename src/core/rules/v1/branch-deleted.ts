import type { Rule } from "../rule.types.js";

export const branchDeleted: Rule = {
  id: "branch-deleted",
  evaluate: (ctx) =>
    ctx.unresolved
      .filter((e) => e.kind === "deleted")
      .map((e) => ({
        rule: "branch-deleted",
        severity: "loses-work",
        subject: { kind: "branch", id: e.branch },
        title: "Branch deleted",
        detail: `${e.lost.length} commit(s) only on ${e.branch}${e.pinRef ? `, kept at ${e.pinRef}` : ""} (if that was intended: git grove ack ${e.branch})`,
        action: `git grove restore ${e.branch}${e.pinRef ? ` ${e.pinRef}` : ""}`,
      })),
};
