import type { Reason, RemovalFacts, Verdict } from "./verdict.types.js";

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Decides whether a worktree can be deleted without losing work.
 * Pure over the gathered facts: `ok` is true only when no reason applies.
 */
export function safeToRemove(facts: RemovalFacts): Verdict {
  const reasons: Reason[] = [];
  if (facts.uncommitted > 0) {
    reasons.push({ code: "uncommitted", detail: `${plural(facts.uncommitted, "uncommitted change")}`, paths: [] });
  }
  if (facts.untracked.length > 0) {
    reasons.push({ code: "untracked", detail: `${plural(facts.untracked.length, "untracked file")}`, paths: facts.untracked });
  }
  if (facts.unpushed > 0) {
    reasons.push({ code: "unpushed", detail: `${plural(facts.unpushed, "commit")} not pushed or merged`, paths: [] });
  }
  if (facts.detachedCommits > 0) {
    reasons.push({ code: "detached-only", detail: `${plural(facts.detachedCommits, "commit")} reachable only from this detached HEAD`, paths: [] });
  }
  if (facts.stashes > 0) {
    reasons.push({ code: "stash", detail: `${plural(facts.stashes, "stash")} on this branch`, paths: [] });
  }
  if (facts.ignoredTruncated) {
    reasons.push({ code: "too-many-ignored", detail: "too many ignored files to check", paths: [] });
  } else if (facts.preciousIgnored.length > 0) {
    reasons.push({
      code: "precious-ignored",
      detail: `${plural(facts.preciousIgnored.length, "ignored file")} that exist only here`,
      paths: facts.preciousIgnored,
    });
  }
  if (facts.nestedWorktrees.length > 0) {
    reasons.push({ code: "nested-worktree", detail: `${plural(facts.nestedWorktrees.length, "worktree")} inside this folder`, paths: facts.nestedWorktrees });
  }
  if (facts.unreadable.length > 0) {
    reasons.push({ code: "unreadable", detail: `could not read ${facts.unreadable.join(", ")}`, paths: [] });
  }
  return { ok: reasons.length === 0, reasons };
}
