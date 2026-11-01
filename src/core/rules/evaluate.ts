import { RULES } from "./registry.js";
import { SEVERITY_RANK, type Finding, type RuleContext } from "./rule.types.js";

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Runs every rule and orders the findings by severity, then rule id, then subject id. */
export function evaluate(ctx: RuleContext): Finding[] {
  return RULES.flatMap((rule) => rule.evaluate(ctx)).sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      compare(a.rule, b.rule) ||
      compare(a.subject.id, b.subject.id),
  );
}
