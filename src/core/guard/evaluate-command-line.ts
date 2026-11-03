import { realpath } from "node:fs/promises";
import { gitLockdown, lockdownOf } from "../git/git-lockdown.js";
import { gitSignal } from "../git/git-signal.js";
import { UntrustedRepoError } from "../git/untrusted-repo.error.js";
import { pin } from "../runner/pin.js";
import { classifyCommand } from "./classify-command.js";
import type { GuardCheck } from "./guard-check.types.js";
import type { GuardBlock, GuardDecision, PendingPin, TakenPin } from "./guard-decision.types.js";
import { judgeDiscard } from "./judge-discard.js";
import { judgeRecursiveRm } from "./judge-recursive-rm.js";
import { judgeWorktreeRemove } from "./judge-worktree-remove.js";
import { readCheckoutOperands } from "./read-checkout-operands.js";
import { readSimpleCommands } from "./read-simple-commands.js";
import { readWorktreeHead } from "./read-worktree-head.js";
import { resolvePins } from "./resolve-pins.js";

/**
 * A command line as an agent's hook reports it: the line, the folder it runs in, and the agent's home folder.
 * `signal` stops every git call the evaluation still has running when it fires. `trustsBare` says whether a bare
 * repository, by its common git dir, may be checked; by default none is.
 */
export type GuardInput = {
  command: string;
  cwd: string;
  home: string;
  signal?: AbortSignal;
  trustsBare?: (commonDir: string) => Promise<boolean>;
};

const TRUSTS_NO_BARE = async (): Promise<boolean> => false;
const UNTRUSTED: unique symbol = Symbol("untrusted");

type Judged = { block: GuardBlock | null; pins: PendingPin[] };

function blocked(block: GuardBlock): GuardDecision {
  return { verdict: "block", ...block };
}

async function subjectAt(cwd: string | null): Promise<GuardBlock["subject"]> {
  const head = cwd === null ? null : await readWorktreeHead(cwd).catch(() => null);
  return head === null ? null : { commonDir: head.commonDir, root: head.root, worktree: head.top, branch: head.branch };
}

async function takePins(pending: readonly PendingPin[], now: () => Date): Promise<TakenPin[]> {
  const taken: TakenPin[] = [];
  const seen = new Set<string>();
  for (const request of pending) {
    const key = `${request.subject.commonDir}\0${request.branch}\0${request.sha}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const pinned = await pin(request.cwd, request.branch, request.sha, now());
    taken.push({ ...request, ...pinned });
  }
  return taken;
}

async function evaluate(input: GuardInput, now: () => Date): Promise<GuardDecision> {
  const from = await realpath(input.cwd).catch(() => input.cwd);
  const line = readSimpleCommands(input.command, from, input.home);
  if (!line.evaluable) return { verdict: "allow", unchecked: true, pins: [] };

  let unchecked = false;
  const pending: PendingPin[] = [];
  for (const command of line.commands) {
    const check = classifyCommand(command);
    if (check.kind === "unchecked") {
      unchecked = true;
      continue;
    }
    if (check.kind === "people-only") return blocked({ message: check.message, verb: check.verb, subject: await subjectAt(check.cwd) });
    const judged = await judge(check, from).catch((error: unknown): typeof UNTRUSTED => {
      if (error instanceof UntrustedRepoError) return UNTRUSTED;
      throw error;
    });
    if (judged === UNTRUSTED) unchecked = true;
    else if (judged.block !== null) return blocked(judged.block);
    else pending.push(...judged.pins);
  }
  return { verdict: "allow", unchecked, pins: await takePins(pending, now) };
}

async function judge(check: GuardCheck, from: string): Promise<Judged> {
  if (check.kind === "worktree-remove") return { block: await judgeWorktreeRemove(check, from), pins: [] };
  if (check.kind === "recursive-rm") return { block: await judgeRecursiveRm(check, from), pins: [] };
  if (check.kind === "discard" || check.kind === "checkout-operands") {
    const discard = check.kind === "discard" ? check : await readCheckoutOperands(check);
    const judged = discard === null ? null : await judgeDiscard(discard, from);
    return { block: judged?.block ?? null, pins: judged?.pins ?? [] };
  }
  if (check.kind === "pin") return { block: null, pins: await resolvePins(check) };
  return { block: null, pins: [] };
}

/**
 * Decides whether a command line may run, evaluating its simple commands in order; the first block wins. Worktree
 * removals and recursive `rm` of worktrees follow the safe-to-remove verdict, commands that discard uncommitted changes
 * are blocked while there are some, and grove's people-only commands are always blocked. When nothing blocks, the
 * tips that rebase, amend, a forced branch delete, a force push or a moving `reset --hard` could lose are pinned,
 * without the repo lock (a pin only adds a ref). Git and store failures reject; the caller decides to allow.
 * Git runs no fsmonitor and no hooks, and a command in a bare repository `trustsBare` does not accept is allowed
 * unchecked, since that repository's config, which could have come with a clone, could run commands.
 */
export async function evaluateCommandLine(input: GuardInput, now: () => Date = () => new Date()): Promise<GuardDecision> {
  const locked = (): Promise<GuardDecision> => gitLockdown.run(lockdownOf(input.trustsBare ?? TRUSTS_NO_BARE), () => evaluate(input, now));
  return input.signal === undefined ? locked() : gitSignal.run(input.signal, locked);
}
