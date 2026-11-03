import type { Finding } from "../../src/core/rules/rule.types.js";

export { worstFinding } from "../../src/core/rules/needs-you.js";

/** A level whose parent moved or merged still needs a restack, even when a gone folder is the row's worst finding. */
export function parentNeedsRestack(findings: readonly Finding[]): boolean {
  return findings.some((finding) => finding.rule === "parent-moved" || finding.rule === "parent-merged");
}
