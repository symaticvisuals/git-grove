import { realpath } from "node:fs/promises";
import { pin } from "../runner/pin.js";
import { classifyCommand } from "./classify-command.js";
import type { GuardBlock, GuardDecision, PendingPin, TakenPin } from "./guard-decision.types.js";
import { judgeDiscard } from "./judge-discard.js";
import { judgeRecursiveRm } from "./judge-recursive-rm.js";
import { judgeWorktreeRemove } from "./judge-worktree-remove.js";
import { readSimpleCommands } from "./read-simple-commands.js";
import { readWorktreeHead } from "./read-worktree-head.js";
import { resolvePins } from "./resolve-pins.js";

/** A command line as an agent's hook reports it: the line, the folder it runs in, and the agent's home folder. */
export type GuardInput = { command: string; cwd: string; home: string };

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

/**
 * Decides whether a command line may run, evaluating its simple commands in order; the first block wins. Worktree
 * removals and recursive `rm` of worktrees follow the safe-to-remove verdict, commands that discard uncommitted changes
 * are blocked while there are some, and grove's people-only commands are always blocked. When nothing blocks, the
 * tips that rebase, amend, a forced branch delete, a force push or a moving `reset --hard` could lose are pinned,
 * without the repo lock (a pin only adds a ref). Git and store failures reject; the caller decides to allow.
 */
export async function evaluateCommandLine(input: GuardInput, now: () => Date = () => new Date()): Promise<GuardDecision> {
  const from = await realpath(input.cwd).catch(() => input.cwd);
  const line = readSimpleCommands(input.command, from, input.home);
  if (!line.evaluable) return { verdict: "allow", unchecked: true, pins: [] };

  let unchecked = false;
  const pending: PendingPin[] = [];
  const setAside = new Set<string>();
  for (const command of line.commands) {
    const check = classifyCommand(command);
    if (check.kind === "unchecked") unchecked = true;
    else if (check.kind === "people-only") return blocked({ message: check.message, verb: check.verb, subject: await subjectAt(check.cwd) });
    else if (check.kind === "worktree-remove") {
      const block = await judgeWorktreeRemove(check, from);
      if (block !== null) return blocked(block);
    } else if (check.kind === "recursive-rm") {
      const block = await judgeRecursiveRm(check, from);
      if (block !== null) return blocked(block);
    } else if (check.kind === "set-aside") {
      const head = await readWorktreeHead(check.cwd).catch(() => null);
      if (head !== null) setAside.add(head.top);
    } else if (check.kind === "discard") {
      const judged = await judgeDiscard(check, from, setAside);
      if (judged.block !== null) return blocked(judged.block);
      pending.push(...judged.pins);
    } else if (check.kind === "pin") {
      pending.push(...(await resolvePins(check)));
    }
  }
  return { verdict: "allow", unchecked, pins: await takePins(pending, now) };
}
