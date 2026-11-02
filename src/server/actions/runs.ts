import { randomBytes } from "node:crypto";
import type { ActionContext, Prepared } from "../../core/actions/action.types.js";
import { errorLine } from "../../core/actions/error-line.js";
import type { Plan, Receipt, StepEvent } from "../../core/actions/plan.types.js";
import { runPrepared } from "../../core/actions/run-prepared.js";
import type { Store, StoredActivity } from "../../core/journal/store.types.js";
import { HttpError } from "../http/http.error.js";
import type { Hub } from "../live/hub.js";
import type { Snapshots } from "../live/snapshots.js";
import { toActivityItem } from "../wire/to-activity-item.js";

export type RunState = { plan: Plan; events: StepEvent[]; receipt: Receipt | null };

export type Runs = {
  /** Starts `prepared` in the background and returns its run id. Throws a 503 HttpError once `close` was called. */
  start(repoId: number, root: string, prepared: Prepared): string;
  /** The run's plan, its step events so far and, once it finished, its receipt; null for an id it does not know. */
  get(runId: string): RunState | null;
  /** True once `close` was called. */
  readonly stopping: boolean;
  /**
   * Refuses new runs and resolves to true once every run in progress has finished, or to false after `timeoutMs`
   * (60 s), logging how many are still going.
   */
  close(options?: { timeoutMs?: number }): Promise<boolean>;
};

/** `home` is grove's folder, whose config.json the runs read. */
export type RunsDeps = { hub: Hub; store: Store; snapshots: Snapshots; home: string };

const KEEP_FINISHED = 50;
const CLOSE_TIMEOUT_MS = 60_000;

function crashed(prepared: Prepared, error: unknown): Receipt {
  const lines = [errorLine(error)];
  return { action: prepared.plan.action, ok: false, refused: false, title: "Stopped: the run failed", lines, pins: [], undo: null, at: Date.now() };
}

function recordingInto(store: Store, rows: StoredActivity[]): Store {
  return {
    ...store,
    addActivity(repoId, item) {
      const id = store.addActivity(repoId, item);
      rows.push({ ...item, id, repoId });
      return id;
    },
  };
}

/**
 * Runs prepared plans with `runPrepared`, each once any refresh of its repository already in flight has finished, and
 * publishes each step event, then the activity rows the run stored, then the receipt, through `hub` as `step`,
 * `activity` and `receipt` events. The repository is scanned again (`hub.scan`, a forced refresh) before the receipt
 * goes out, so a client that refetches on the receipt sees the change. Keeps the 50 newest finished runs.
 */
export function createRuns({ hub, store, snapshots, home }: RunsDeps): Runs {
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
    await snapshots.idle(repoId);
    const rows: StoredActivity[] = [];
    const recording = { ...ctx, store: recordingInto(ctx.store, rows) };
    const receipt = await runPrepared(recording, prepared, emit).catch((error: unknown) => crashed(prepared, error));
    for (const row of rows) hub.publish({ type: "activity", item: toActivityItem(row, row.repoId) });
    await hub.scan(repoId).catch(() => undefined);
    state.receipt = receipt;
    hub.publish({ type: "receipt", runId, receipt });
    forgetOld();
  };

  const drained = async (): Promise<void> => {
    while (inFlight.size > 0) await Promise.all(inFlight);
  };

  return {
    start(repoId, root, prepared) {
      if (closed) throw new HttpError(503, "git grove is stopping");
      const runId = randomBytes(16).toString("base64url");
      const state: RunState = { plan: prepared.plan, events: [], receipt: null };
      runs.set(runId, state);
      const ctx: ActionContext = { root, store, now: Date.now, home };
      const running = execute(runId, repoId, ctx, prepared, state).catch((error: unknown) => {
        process.stderr.write(`git-grove: run ${runId}: ${errorLine(error)}\n`);
      });
      inFlight.add(running);
      void running.then(() => inFlight.delete(running));
      return runId;
    },
    get: (runId) => runs.get(runId) ?? null,
    get stopping() {
      return closed;
    },
    async close({ timeoutMs = CLOSE_TIMEOUT_MS } = {}) {
      closed = true;
      let timer: NodeJS.Timeout | undefined;
      const timedOut = new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(true), timeoutMs);
      });
      const gaveUp = await Promise.race([drained().then(() => false), timedOut]);
      clearTimeout(timer);
      if (gaveUp) process.stderr.write(`git-grove: stopping with ${inFlight.size} run(s) still in progress\n`);
      return !gaveUp;
    },
  };
}
