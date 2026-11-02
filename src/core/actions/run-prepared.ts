import { performance } from "node:perf_hooks";
import { readRepoFacts } from "../facts/read-repo-facts.js";
import { groveHome } from "../grove-home.js";
import { runGit } from "../git/run-git.js";
import { pin } from "../runner/pin.js";
import { RefusedError } from "../runner/refused.error.js";
import { RepoLockedError } from "../runner/repo-locked.error.js";
import { withRepoLock } from "../runner/with-repo-lock.js";
import type { ActionContext, ExecuteResult, Prepared } from "./action.types.js";
import { checkExpectations } from "./check-expectations.js";
import { errorLine } from "./error-line.js";
import { lockedRefusal } from "./locked-refusal.js";
import type { Plan, Receipt, StepEvent } from "./plan.types.js";
import { StalePlanError } from "./stale-plan.error.js";

type Outcome = ExecuteResult & { refused: boolean };

function refused(title: string, lines: string[]): Outcome {
  return { ok: false, refused: true, title, lines, undo: null };
}

async function readCommonDir(root: string): Promise<string> {
  return (await runGit(["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root })).stdout.trim();
}

function branchOf(plan: Plan): string | null {
  const tips = plan.expects.flatMap((expect) => (expect.kind === "tip" ? [expect.branch] : []));
  const branches = new Set([...plan.moves, ...tips]);
  return branches.size === 1 ? ([...branches][0] ?? null) : null;
}

/**
 * Runs a prepared action and resolves to its receipt; refusals and stops are receipts, never throws.
 * A plan with blockers runs nothing. Otherwise it takes the repo lock, reads the repository and checks every
 * expectation (step 0), pins each branch in `moves` at its current tip (step 1), then runs `execute` from the next
 * step. Steps never reported are emitted as skipped, and the receipt is recorded as activity; a receipt that could
 * not be recorded says so in its last line.
 */
export async function runPrepared(
  ctx: ActionContext,
  prepared: Prepared,
  emit: (event: StepEvent) => void,
): Promise<Receipt> {
  const { plan } = prepared;
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
      send({ index, state: "failed", detail: errorLine(error), ms: elapsed() });
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
    const home = ctx.home ?? groveHome();
    return { ...(await prepared.execute({ facts, pins, firstStep, home, step, skip })), refused: false };
  };

  const outcomeOf = (error: unknown): Outcome => {
    if (error instanceof RepoLockedError) {
      const { title, lines } = lockedRefusal(error.lockPath);
      return refused(title, lines);
    }
    if (error instanceof StalePlanError) return refused("Changed since you looked", error.mismatches);
    if (error instanceof RefusedError) return refused(`Refused: ${stepTitle()}`, [errorLine(error)]);
    return { ok: false, refused: false, title: `Stopped: ${stepTitle()}`, lines: [errorLine(error)], undo: null };
  };

  let outcome: Outcome;
  let commonDir: string | null = null;
  if (plan.blockers.length > 0) {
    outcome = refused("Not run", plan.blockers);
  } else {
    try {
      commonDir = await readCommonDir(ctx.root);
      outcome = await withRepoLock(commonDir, run);
    } catch (error) {
      outcome = outcomeOf(error);
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
    undo: outcome.undo,
    at: ctx.now(),
  };
  try {
    const dir = commonDir ?? (await readCommonDir(ctx.root));
    const repoId = ctx.store.findRepoId(dir) ?? ctx.store.repoId(dir, ctx.root);
    ctx.store.addActivity(repoId, {
      kind: "action",
      branch: branchOf(plan),
      title: receipt.title,
      detail: receipt.lines.join("; "),
      at: receipt.at,
    });
    return receipt;
  } catch {
    return { ...receipt, lines: [...receipt.lines, "This action was not recorded in Activity"] };
  }
}
