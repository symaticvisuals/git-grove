import type { RepoFacts } from "../facts/facts.types.js";
import type { Store } from "../journal/store.types.js";
import type { ActionName, Plan, RestoreTarget } from "./plan.types.js";

/** `root` is the repository's main worktree. */
export type ActionContext = { root: string; store: Store; now: () => number };

/**
 * What `execute` gets: facts read under the lock, the pin taken for each branch in `moves` (branch to pin ref),
 * and `firstStep`, the index of the first plan step that is its own. `step` reports a step running then done
 * with the detail `work` resolves to, or failed when it throws, and rethrows.
 */
export type RunContext = {
  facts: RepoFacts;
  pins: Map<string, string>;
  firstStep: number;
  step(index: number, work: () => Promise<string>): Promise<string>;
  skip(index: number, why: string): void;
};

export type ExecuteResult = { ok: boolean; title: string; lines: string[]; undo: RestoreTarget[] | null };

export type Prepared = { plan: Plan; execute(run: RunContext): Promise<ExecuteResult> };

/** `prepare` throws InvalidInputError when `raw` is not this action's input. */
export type ActionDef = { name: ActionName; prepare(ctx: ActionContext, raw: unknown): Promise<Prepared> };
