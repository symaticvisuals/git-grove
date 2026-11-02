import type { Receipt } from "../../../src/core/actions/plan.types.js";
import type { Api } from "../api.js";
import { ApiError } from "../api.error.js";
import { MESSAGES } from "../messages.js";
import type { SliceName } from "../slice-names.js";
import type { State, UiAction } from "../state.js";
import { DIALOGS } from "./dialog-specs.js";

export type DialogEffectsDeps = {
  api(): Pick<Api, "plan" | "run" | "runState"> | null;
  state(): State;
  dispatch(action: UiAction): void;
  toast(text: string, ok: boolean): void;
};

export type DialogEffects = { after(before: State, after: State, action?: UiAction): void };

const PREVIEW_PAUSE_MS = 250;
const RESTARTED = "git grove restarted while this ran. Check the repo to see where it stopped.";
const CHANGED: SliceName[] = ["projects", "repo", "feature", "needs", "pins", "activity"];

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : MESSAGES.notRunning;
}

function statusOf(error: unknown): number {
  return error instanceof ApiError ? error.status : 0;
}

/**
 * What the dialogs ask git grove for, driven by each state change: a preview at once when a dialog opens or must be
 * checked again, and 250 ms after the last change while a form is edited; the run once a plan is confirmed; the run's
 * state once right after it starts and again after the stream drops, so no step is missed, one read at a time: a read
 * asked for while one is in flight runs once more after it. A receipt toasts and
 * reloads what the run changed, including a run whose dialog was replaced by another; a run that fails after its
 * dialog was hidden says why in a toast.
 */
export function createDialogEffects(deps: DialogEffectsDeps): DialogEffects {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let scheduled = "";
  let starting: string | null = null;
  let syncing: string | null = null;
  const started = new Set<string>();

  const preview = (id: number, revision: number): void => {
    const dialog = deps.state().dialog;
    const api = deps.api();
    if (api === null || dialog === null || dialog.id !== id || dialog.revision !== revision || !dialog.planning) return;
    api.plan({ repo: dialog.repoId, action: dialog.action, input: DIALOGS[dialog.action].toInput(dialog.values) }).then(
      ({ planId, plan }) => deps.dispatch({ type: "dialog-planned", dialog: id, revision, planId, plan }),
      (error: unknown) => deps.dispatch({ type: "dialog-plan-failed", dialog: id, revision, message: messageOf(error) }),
    );
  };

  const schedulePreview = (state: State): void => {
    const { dialog } = state;
    if (dialog === null || dialog.stage !== "review" || !dialog.planning) return;
    const key = `${dialog.id}:${dialog.revision}`;
    if (key === scheduled) return;
    scheduled = key;
    clearTimeout(timer);
    const { id, revision } = dialog;
    timer = setTimeout(() => preview(id, revision), dialog.debounce ? PREVIEW_PAUSE_MS : 0);
  };

  const startRun = (state: State): void => {
    const { run } = state;
    const api = deps.api();
    if (api === null || run === null || run.runId !== null || run.planId === starting) return;
    const { planId, dialog } = run;
    starting = planId;
    api.run(planId).then(
      ({ runId }) => {
        started.add(runId);
        deps.dispatch({ type: "run-started", planId, runId });
      },
      (error: unknown) => {
        const hidden = deps.state().dialog?.id !== dialog;
        deps.dispatch({ type: "run-failed", planId, status: statusOf(error), message: messageOf(error) });
        if (hidden) deps.toast(messageOf(error), false);
      },
    );
  };

  const syncRun = (state: State): void => {
    const { run } = state;
    const api = deps.api();
    if (api === null || run === null || run.runId === null || run.sync <= run.synced || syncing === run.runId) return;
    const { runId, sync: request } = run;
    syncing = runId;
    api.runState(runId).then(
      (read) => {
        syncing = null;
        deps.dispatch({ type: "run-synced", runId, request, state: read });
      },
      (error: unknown) => {
        syncing = null;
        deps.dispatch({ type: "run-sync-failed", runId, request, message: statusOf(error) === 404 ? RESTARTED : messageOf(error) });
      },
    );
  };

  const landed = (receipt: Receipt): void => {
    deps.toast(receipt.title, receipt.ok);
    for (const slice of CHANGED) deps.dispatch({ type: "invalidate", slice });
  };

  const receipts = (before: State, after: State, action: UiAction | undefined): void => {
    const { run } = after;
    if (run !== null && run.receipt !== null && (before.run?.runId !== run.runId || before.run.receipt === null)) {
      landed(run.receipt);
      return;
    }
    if (action?.type === "event" && action.event.type === "receipt" && started.has(action.event.runId) && run?.runId !== action.event.runId) {
      landed(action.event.receipt);
    }
  };

  return {
    after(before, after, action) {
      schedulePreview(after);
      startRun(after);
      syncRun(after);
      receipts(before, after, action);
    },
  };
}
