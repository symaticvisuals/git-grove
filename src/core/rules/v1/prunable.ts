import { basename } from "node:path";
import { plural } from "../plural.js";
import type { Finding, Rule } from "../rule.types.js";

function strandedDetail(path: string, stranded: number | null): string {
  if (stranded === null) return `${path} no longer exists on disk; could not check commits on its detached HEAD`;
  return `${path} no longer exists on disk, with ${plural(stranded, "commit")} only on its detached HEAD`;
}

export const prunable: Rule = {
  id: "prunable",
  evaluate: (ctx) => {
    const out: Finding[] = [];
    for (const w of ctx.facts.worktrees) {
      if (!w.prunable) continue;
      const detachedHead = w.branch === null ? w.head : null;
      const stranded = ctx.detachedOnly.get(w.path);
      if (detachedHead !== null && stranded !== undefined && stranded !== 0) {
        out.push({
          rule: "prunable",
          severity: "loses-work",
          subject: { kind: "worktree", id: w.path },
          title: "Worktree folder is gone",
          detail: strandedDetail(w.path, stranded),
          action: `git branch rescue/${basename(w.path)} ${detachedHead}`,
        });
        continue;
      }
      out.push({
        rule: "prunable",
        severity: "needs-action",
        subject: { kind: "worktree", id: w.path },
        title: "Worktree folder is gone",
        detail: `${w.path} no longer exists on disk`,
        action: "git worktree prune",
      });
    }
    return out;
  },
};
