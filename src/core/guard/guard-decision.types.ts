import type { Sha } from "../facts/facts.types.js";

/** The repository a decision is about: its common git dir, its main worktree, and the worktree and branch involved. */
export type GuardSubject = { commonDir: string; root: string; worktree: string; branch: string | null };

/** A command the guard refuses: the message for the agent, the command's short name, and what it is about. */
export type GuardBlock = { message: string; verb: string; subject: GuardSubject | null };

/** A tip to pin once the whole line is allowed, and where to run git for it. */
export type PendingPin = { cwd: string; subject: GuardSubject; verb: string; branch: string; sha: Sha };

/** A pin the guard took; `reused` when an existing pin already held the tip. */
export type TakenPin = PendingPin & { ref: string; reused: boolean };

/**
 * The guard's answer for a command line. An allowed line is `unchecked` when some of it could not be evaluated, and
 * lists the pins taken before it runs.
 */
export type GuardDecision = ({ verdict: "block" } & GuardBlock) | { verdict: "allow"; unchecked: boolean; pins: TakenPin[] };
