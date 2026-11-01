import { plural } from "../plural.js";
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
        detail: `${plural(e.lost.length, "commit")} no longer on ${e.branch}${e.pinRef ? `, kept at ${e.pinRef}` : ""} (if that was intended: git grove ack ${e.branch})`,
        action: `git grove restore ${e.branch}${e.pinRef ? ` ${e.pinRef}` : ""}`,
      })),
};
