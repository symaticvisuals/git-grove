import { performance } from "node:perf_hooks";
import { readRepoFacts } from "../facts/read-repo-facts.js";
import { runGit } from "../git/run-git.js";
import { pin } from "../runner/pin.js";
import { RefusedError } from "../runner/refused.error.js";
import { RepoLockedError } from "../runner/repo-locked.error.js";
import { withRepoLock } from "../runner/with-repo-lock.js";
import type { ActionContext, ExecuteResult, Prepared } from "./action.types.js";
import { checkExpectations } from "./check-expectations.js";
import type { Plan, Receipt, StepEvent } from "./plan.types.js";
import { StalePlanError } from "./stale-plan.error.js";

type Outcome = ExecuteResult & { refused: boolean };

function refused(title: string, lines: string[]): Outcome {
  return { ok: false, refused: true, title, lines, undo: null };
}

function messageOf(error: unknown): string {
  if (error instanceof StalePlanError) return error.mismatches.join("; ");
  const message = error instanceof Error ? error.message : String(error);
  return (message.split("\n")[0] ?? message).replace(/^git-grove: /, "");
}

/** The one branch the plan is about, or null when it names none or several. */
function branchOf(plan: Plan): string | null {
  const tips = plan.expects.flatMap((expect) => (expect.kind === "tip" ? [expect.branch] : []));
  const branches = new Set([...plan.moves, ...tips]);
  return branches.size === 1 ? ([...branches][0] ?? null) : null;
}

/**
 * Runs a prepared action and resolves to its receipt; refusals and stops are receipts, never throws.
 * A plan with blockers runs nothing. Otherwise it takes the repo lock, reads the repository and checks every
 * expectation (step 0), pins each branch in `moves` at its current tip (step 1), then runs `execute` from the next
 * step. Steps never reported are emitted as skipped, and the receipt is recorded as activity.
 */
export async function runPrepared(
  ctx: ActionContext,
  prepared: Prepared,
  emit: (event: StepEvent) => void,
): Promise<Receipt> {
  const { plan } = prepared;
  const probe = await runGit(["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: ctx.root });
  const commonDir = probe.stdout.trim();
  const reported = new Set<number>();
  const pins = new Map<string, string>();
  let failedAt: number | null = null;

  const send = (event: StepEvent): void => {
    reported.add(event.index);
    emit(event);
  };
  const measure = async <T>(index: number, work: () => Promise<T>, detailOf: (value: T) => string): Promise<T> => {
    const started = performance.now();
    const elapsed = (): number => Math.round(performance.now() - started);
    send({ index, state: "running", detail: plan.steps[index]?.detail ?? "", ms: null });
    try {
      const value = await work();
      send({ index, state: "done", detail: detailOf(value), ms: elapsed() });
      return value;
    } catch (error) {
      failedAt = index;
      send({ index, state: "failed", detail: messageOf(error), ms: elapsed() });
      throw error;
    }
  };
  const step = (index: number, work: () => Promise<string>): Promise<string> => measure(index, work, (detail) => detail);
  const skip = (index: number, why: string): void => send({ index, state: "skipped", detail: why, ms: null });
  const stepTitle = (): string => {
    const index = failedAt ?? plan.steps.findIndex((_, candidate) => !reported.has(candidate));
    return plan.steps[index]?.title ?? plan.steps.at(-1)?.title ?? plan.title;
  };

  const run = async (): Promise<Outcome> => {
    const facts = await measure(
      0,
      async () => {
        const read = await readRepoFacts(ctx.root);
        const mismatches = await checkExpectations(read, plan.expects);
        if (mismatches.length > 0) throw new StalePlanError(mismatches);
        return read;
      },
      () => plan.steps[0]?.detail || "Nothing moved",
    );
    if (plan.moves.length > 0) {
      await step(1, async () => {
        for (const branch of plan.moves) {
          const tip = facts.branches.find((candidate) => candidate.name === branch)?.tip;
          if (tip !== undefined) pins.set(branch, await pin(facts.root, branch, tip, new Date(ctx.now())));
        }
        return [...pins.values()].join(", ") || "Nothing to pin";
      });
    }
    const firstStep = plan.moves.length > 0 ? 2 : 1;
    return { ...(await prepared.execute({ facts, pins, firstStep, step, skip })), refused: false };
  };

  let outcome: Outcome;
  if (plan.blockers.length > 0) {
    outcome = refused("Not run", plan.blockers);
  } else {
    try {
      outcome = await withRepoLock(commonDir, run);
    } catch (error) {
      if (error instanceof RepoLockedError) {
        outcome = refused("Another grove action is running in this repo", ["Wait for it to finish, then try again."]);
      } else if (error instanceof StalePlanError) {
        outcome = refused("Changed since you looked", error.mismatches);
      } else if (error instanceof RefusedError) {
        outcome = refused(`Refused: ${stepTitle()}`, [messageOf(error)]);
      } else {
        outcome = { ok: false, refused: false, title: `Stopped: ${stepTitle()}`, lines: [messageOf(error)], undo: null };
      }
    }
  }

  const why = outcome.refused ? outcome.title : "Not reached";
  plan.steps.forEach((_, index) => {
    if (!reported.has(index)) skip(index, why);
  });

  const receipt: Receipt = {
    action: plan.action,
    ok: outcome.ok,
    refused: outcome.refused,
    title: outcome.title,
    lines: outcome.lines,
    pins: [...pins.values()],
    undo: outcome.ok ? outcome.undo : null,
    at: ctx.now(),
  };
  const repoId = ctx.store.findRepoId(commonDir) ?? ctx.store.repoId(commonDir, ctx.root);
  ctx.store.addActivity(repoId, {
    kind: "action",
    branch: branchOf(plan),
    title: receipt.title,
    detail: receipt.lines.join("; "),
    at: receipt.at,
  });
  return receipt;
}
