import { isAncestor } from "../git/is-ancestor.js";
import { resolveCommit } from "../git/resolve-commit.js";
import { runGit } from "../git/run-git.js";
import type { GuardCheck, PinRequest } from "./guard-check.types.js";
import type { PendingPin } from "./guard-decision.types.js";
import { readWorktreeHead } from "./read-worktree-head.js";

const HEADS = "refs/heads/";

function short(ref: string): string {
  return ref.startsWith(HEADS) ? ref.slice(HEADS.length) : ref;
}

async function trackingRef(cwd: string, local: string, request: PinRequest & { kind: "push" }): Promise<string | null> {
  if (request.remote !== null) return `refs/remotes/${request.remote}/${short(request.destination ?? local)}`;
  const push = await runGit(["rev-parse", "--symbolic-full-name", `${local}@{push}`], { cwd, allowFailure: true });
  const ref = push.stdout.trim();
  return push.code === 0 && ref !== "" ? ref : null;
}

/**
 * The tips a command could lose, resolved to commits: the checked-out branch's tip, each named branch's tip, and for a
 * force push the remote-tracking tip it would replace, pinned under the local branch's name. A force push that only
 * fast-forwards the remote, a branch that does not exist and a detached HEAD give nothing to pin.
 */
export async function resolvePins(check: GuardCheck & { kind: "pin" }): Promise<PendingPin[]> {
  const { cwd, verb } = check;
  const head = await readWorktreeHead(cwd);
  const pending: PendingPin[] = [];
  const add = (branch: string, sha: string): void => {
    pending.push({ cwd, verb, branch, sha, subject: { commonDir: head.commonDir, root: head.root, worktree: head.top, branch } });
  };
  for (const request of check.pins) {
    if (request.kind === "head") {
      if (head.branch !== null && head.sha !== null) add(head.branch, head.sha);
      continue;
    }
    const local = request.kind === "branch" ? short(request.name) : request.source === null ? head.branch : short(request.source);
    const localTip = local === null ? null : await resolveCommit(cwd, `${HEADS}${local}`);
    if (local === null || localTip === null) continue;
    if (request.kind === "branch") {
      add(local, localTip);
      continue;
    }
    const tracking = await trackingRef(cwd, local, request);
    const remoteTip = tracking === null ? null : await resolveCommit(cwd, tracking);
    if (remoteTip !== null && !(await isAncestor(cwd, remoteTip, localTip))) add(local, remoteTip);
  }
  return pending;
}
