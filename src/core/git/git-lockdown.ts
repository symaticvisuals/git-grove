import { AsyncLocalStorage } from "node:async_hooks";

/**
 * How `runGit` treats repositories inside `gitLockdown.run(…)`, the guard's evaluation of a command an agent has not
 * run yet. `trustsBare` says whether a bare repository, by its common git dir, is one grove may run git in.
 */
export type GitLockdown = { trustsBare: (commonDir: string) => Promise<boolean>; verdicts: Map<string, Promise<boolean>> };

/** The lockdown of every git call `runGit` makes inside `gitLockdown.run(lockdown, …)`. */
export const gitLockdown = new AsyncLocalStorage<GitLockdown>();

/** A lockdown that trusts the bare repositories `trustsBare` accepts, remembering each answer by folder. */
export function lockdownOf(trustsBare: (commonDir: string) => Promise<boolean>): GitLockdown {
  return { trustsBare, verdicts: new Map() };
}
