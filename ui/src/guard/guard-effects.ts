import type { Api } from "../api.js";
import { ApiError } from "../api.error.js";
import { MESSAGES } from "../messages.js";
import type { State, UiAction } from "../state.js";

export type GuardEffectsDeps = {
  api(): Pick<Api, "guardPlan" | "guardRun"> | null;
  state(): State;
  dispatch(action: UiAction): void;
  toast(text: string, ok: boolean): void;
};

export type GuardEffects = { after(state: State): void };

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : MESSAGES.notRunning;
}

/**
 * What the agent guard dialog asks git grove for, driven by each state change: a preview for each revision that
 * needs one, and the change once a plan is confirmed, each once. A receipt toasts, reloads the guard's state, and
 * lands in its dialog; a change that fails after its dialog was closed says why in a toast.
 */
export function createGuardEffects(deps: GuardEffectsDeps): GuardEffects {
  let previewed = "";
  let ran = "";
  return {
    after(state) {
      const dialog = state.guardDialog;
      const api = deps.api();
      if (dialog === null || api === null) return;
      const { id, revision, planId } = dialog;
      if (dialog.stage === "review" && dialog.planning && previewed !== `${id}:${revision}`) {
        previewed = `${id}:${revision}`;
        api.guardPlan(dialog.change).then(
          (reply) => deps.dispatch({ type: "guard-planned", dialog: id, revision, planId: reply.planId, plan: reply.plan }),
          (error: unknown) => deps.dispatch({ type: "guard-plan-failed", dialog: id, revision, message: messageOf(error) }),
        );
      }
      if (dialog.stage === "run" && planId !== null && ran !== `${id}:${planId}`) {
        ran = `${id}:${planId}`;
        api.guardRun(planId).then(
          ({ receipt }) => {
            deps.toast(receipt.title, receipt.ok);
            deps.dispatch({ type: "invalidate", slice: "guard" });
            deps.dispatch({ type: "guard-ran", dialog: id, receipt });
          },
          (error: unknown) => {
            const hidden = deps.state().guardDialog?.id !== id;
            deps.dispatch({ type: "guard-run-failed", dialog: id, status: error instanceof ApiError ? error.status : 0, message: messageOf(error) });
            if (hidden) deps.toast(messageOf(error), false);
          },
        );
      }
    },
  };
}
