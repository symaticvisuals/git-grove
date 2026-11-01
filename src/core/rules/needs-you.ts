import { SEVERITY_RANK, type Finding, type Severity } from "./rule.types.js";

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
