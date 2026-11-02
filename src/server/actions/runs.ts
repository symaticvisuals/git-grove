import { randomBytes } from "node:crypto";
import type { ActionContext, Prepared } from "../../core/actions/action.types.js";
import { errorLine } from "../../core/actions/error-line.js";
import type { Plan, Receipt, StepEvent } from "../../core/actions/plan.types.js";
import { runPrepared } from "../../core/actions/run-prepared.js";
import type { Store } from "../../core/journal/store.types.js";
import { HttpError } from "../http/http.error.js";
import type { Hub } from "../live/hub.js";

export type RunState = { plan: Plan; events: StepEvent[]; receipt: Receipt | null };

export type Runs = {
  /** Starts `prepared` in the background and returns its run id. Throws a 503 HttpError once `close` was called. */
  start(repoId: number, root: string, prepared: Prepared): string;
  /** The run's plan, its step events so far and, once it finished, its receipt; null for an id it does not know. */
  get(runId: string): RunState | null;
  /** Refuses new runs, and resolves once every run in progress has finished. */
  close(): Promise<void>;
};

const KEEP_FINISHED = 50;

function crashed(prepared: Prepared, error: unknown): Receipt {
  const lines = [errorLine(error)];
  return { action: prepared.plan.action, ok: false, refused: false, title: "Stopped: the run failed", lines, pins: [], undo: null, at: Date.now() };
}

/**
 * Runs prepared plans with `runPrepared` and publishes each step event, then the receipt, through `hub` as `step` and
 * `receipt` events with the run's id. The repository is scanned again (`hub.scan`, a forced refresh) before the receipt
 * goes out, so a client that refetches on the receipt sees the change. Keeps the 50 newest finished runs.
 */
export function createRuns(hub: Hub, store: Store): Runs {
  const runs = new Map<string, RunState>();
  const inFlight = new Set<Promise<void>>();
  let closed = false;

  const forgetOld = (): void => {
    const finished = [...runs].filter(([, state]) => state.receipt !== null);
    for (const [id] of finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED))) runs.delete(id);
  };

  const execute = async (runId: string, repoId: number, ctx: ActionContext, prepared: Prepared, state: RunState): Promise<void> => {
    const emit = (event: StepEvent): void => {
      state.events.push(event);
      hub.publish({ type: "step", runId, event });
    };
    const receipt = await runPrepared(ctx, prepared, emit).catch((error: unknown) => crashed(prepared, error));
    await hub.scan(repoId).catch(() => undefined);
    state.receipt = receipt;
    hub.publish({ type: "receipt", runId, receipt });
    forgetOld();
  };

  return {
    start(repoId, root, prepared) {
      if (closed) throw new HttpError(503, "git grove is stopping");
      const runId = randomBytes(16).toString("base64url");
      const state: RunState = { plan: prepared.plan, events: [], receipt: null };
      runs.set(runId, state);
      const running = execute(runId, repoId, { root, store, now: Date.now }, prepared, state).catch((error: unknown) => {
        process.stderr.write(`git-grove: run ${runId}: ${errorLine(error)}\n`);
      });
      inFlight.add(running);
      void running.then(() => inFlight.delete(running));
      return runId;
    },
    get: (runId) => runs.get(runId) ?? null,
    async close() {
      closed = true;
      while (inFlight.size > 0) await Promise.all(inFlight);
    },
  };
}
