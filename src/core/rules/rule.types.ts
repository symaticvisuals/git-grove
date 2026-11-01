import type { RepoFacts } from "../facts/facts.types.js";
import type { JournalEntry } from "../journal/store.types.js";
import type { Feature } from "../stacks/stacks.types.js";
import type { Verdict } from "./verdict.types.js";

export type Severity = "loses-work" | "needs-action" | "waiting-on-review" | "idle";

export type Finding = {
  rule: string;
  severity: Severity;
  subject: { kind: "branch" | "worktree" | "level"; id: string };
  title: string;
  detail: string;
  action: string | null;
};

/**
 * `removals` is keyed by worktree path; `envMissing` by worktree path to the missing file names;
 * `detachedOnly` by the path of a prunable detached worktree to the commits only its HEAD holds.
 */
export type RuleContext = {
  facts: RepoFacts;
  features: Feature[];
  unresolved: JournalEntry[];
  removals: Map<string, Verdict>;
  envMissing: Map<string, string[]>;
  detachedOnly: Map<string, number>;
  now: number;
};

export type Rule = { id: string; evaluate(ctx: RuleContext): Finding[] };

/** Lower rank is worse. */
export const SEVERITY_RANK: Record<Severity, number> = {
  "loses-work": 0,
  "needs-action": 1,
  "waiting-on-review": 2,
  idle: 3,
};
