import { SEVERITY_RANK, type Finding, type Severity } from "./rule.types.js";

/**
 * The worst of `findings`, the first one on a tie, except that a gone worktree (`prunable`) wins a tie. A folder that
 * is already gone is what the row should say, ahead of another finding of the same severity such as a merged parent.
 * Null for none.
 */
export function worstFinding(findings: readonly Finding[]): Finding | null {
  let worst: Finding | null = null;
  for (const finding of findings) {
    if (worst === null || outranks(finding, worst)) worst = finding;
  }
  return worst;
}

function outranks(finding: Finding, worst: Finding): boolean {
  const bySeverity = SEVERITY_RANK[finding.severity] - SEVERITY_RANK[worst.severity];
  if (bySeverity !== 0) return bySeverity < 0;
  return finding.rule === "prunable" && worst.rule !== "prunable";
}

/** Findings at needs-action or worse, worst first, keeping input order within a severity. */
export function needsYou(findings: Finding[]): Finding[] {
  return findings
    .map((finding, index) => ({ finding, index }))
    .filter(({ finding }) => SEVERITY_RANK[finding.severity] <= SEVERITY_RANK["needs-action"])
    .sort((a, b) => SEVERITY_RANK[a.finding.severity] - SEVERITY_RANK[b.finding.severity] || a.index - b.index)
    .map(({ finding }) => finding);
}

export function worst(findings: Finding[]): Severity | "fine" {
  let result: Severity | "fine" = "fine";
  for (const f of findings) {
    if (result === "fine" || SEVERITY_RANK[f.severity] < SEVERITY_RANK[result]) result = f.severity;
  }
  return result;
}
