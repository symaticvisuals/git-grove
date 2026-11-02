import type { Finding, Severity } from "../../src/core/rules/rule.types.js";

const RANK: Record<Severity, number> = { "loses-work": 0, "needs-action": 1, "waiting-on-review": 2, idle: 3 };

/** The worst of `findings`, the first one on a tie; null for none. */
export function worstFinding(findings: readonly Finding[]): Finding | null {
  let worst: Finding | null = null;
  for (const finding of findings) if (worst === null || RANK[finding.severity] < RANK[worst.severity]) worst = finding;
  return worst;
}
