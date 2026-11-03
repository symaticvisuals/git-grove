import type { GuardChange, GuardPlan, GuardReceipt, GuardStatus } from "../../../src/core/guard-install/guard-install.types.js";
import type { DialogState, PaletteState } from "../dialogs/reduce-dialog.js";

/**
 * The open agent guard dialog. `revision` counts the previews asked for; a reply for an older one is dropped. `armed`
 * is the plan id whose confirm has been on screen long enough to take. `stage` is `run` while the change is made and
 * `done` once its receipt is back.
 */
export type GuardDialogState = {
  id: number;
  change: GuardChange;
  revision: number;
  planning: boolean;
  plan: GuardPlan | null;
  planId: string | null;
  armed: string | null;
  error: string | null;
  notice: string | null;
  stage: "review" | "run" | "done";
  receipt: GuardReceipt | null;
};

/** `guardDismissed` is the status the onboarding card was put off for with "Not now". */
export type GuardSlices = {
  guardDialog: GuardDialogState | null;
  guardDismissed: GuardStatus | null;
  dialog: DialogState | null;
  palette: PaletteState | null;
  dialogSeq: number;
};

export type GuardAction =
  | { type: "guard-open"; change: GuardChange }
  | { type: "guard-planned"; dialog: number; revision: number; planId: string; plan: GuardPlan }
  | { type: "guard-plan-failed"; dialog: number; revision: number; message: string }
  | { type: "guard-armed"; dialog: number; planId: string }
  | { type: "guard-confirm"; planId: string }
  | { type: "guard-ran"; dialog: number; receipt: GuardReceipt }
  | { type: "guard-run-failed"; dialog: number; status: number; message: string }
  | { type: "guard-again" }
  | { type: "guard-close" }
  | { type: "guard-dismiss"; status: GuardStatus };

const EXPIRED = "That preview expired, so grove read the file again. Look it over, then confirm.";

function opened(slices: GuardSlices, change: GuardChange): GuardSlices {
  if (slices.dialog !== null) return slices;
  const id = slices.dialogSeq + 1;
  const guardDialog: GuardDialogState = { id, change, revision: 0, planning: true, plan: null, planId: null, armed: null, error: null, notice: null, stage: "review", receipt: null };
  return { ...slices, guardDialog, dialogSeq: id, palette: null };
}

function previewAgain(dialog: GuardDialogState, notice: string | null): GuardDialogState {
  return { ...dialog, stage: "review", revision: dialog.revision + 1, planning: true, planId: null, armed: null, error: null, notice, receipt: null };
}

function confirmable(dialog: GuardDialogState, planId: string): boolean {
  return dialog.stage === "review" && dialog.plan !== null && dialog.planId === planId && dialog.armed === planId && !dialog.planning && dialog.error === null && dialog.plan.blockers.length === 0;
}

function current(dialog: GuardDialogState, action: { dialog: number; revision: number }): boolean {
  return dialog.id === action.dialog && dialog.revision === action.revision && dialog.stage === "review" && dialog.planning;
}

function step(dialog: GuardDialogState, action: GuardAction): GuardDialogState | null {
  switch (action.type) {
    case "guard-planned":
      return current(dialog, action) ? { ...dialog, plan: action.plan, planId: action.planId, armed: null, planning: false, error: null } : dialog;
    case "guard-plan-failed":
      return current(dialog, action) ? { ...dialog, plan: null, planId: null, armed: null, planning: false, error: action.message } : dialog;
    case "guard-armed":
      return dialog.id === action.dialog && dialog.planId === action.planId && dialog.stage === "review" && dialog.armed !== action.planId ? { ...dialog, armed: action.planId } : dialog;
    case "guard-confirm":
      return confirmable(dialog, action.planId) ? { ...dialog, stage: "run" } : dialog;
    case "guard-ran":
      return dialog.id === action.dialog && dialog.stage === "run" ? { ...dialog, stage: "done", receipt: action.receipt } : dialog;
    case "guard-run-failed":
      if (dialog.id !== action.dialog || dialog.stage !== "run") return dialog;
      return action.status === 410 ? previewAgain(dialog, EXPIRED) : { ...dialog, stage: "review", planId: null, armed: null, error: action.message };
    case "guard-again":
      if (dialog.stage === "review" && dialog.error !== null) return previewAgain(dialog, null);
      return dialog.stage === "done" && dialog.receipt?.ok === false ? previewAgain({ ...dialog, plan: null }, null) : dialog;
    case "guard-close":
      return null;
    default:
      return dialog;
  }
}

/**
 * The agent guard's dialog and onboarding card after `action`; pure, and the same object when nothing changed. A
 * dialog opens only while no action dialog is, closing the palette, and previews at once. Confirm takes the plan only
 * when the id painted on its button is the plan shown, that plan has been armed, and nothing is being checked,
 * failing or blocking it. A run refused because its preview expired previews it again at once. "Not now" hides the
 * card for the status it was shown for.
 */
export function reduceGuard(slices: GuardSlices, action: GuardAction): GuardSlices {
  if (action.type === "guard-open") return opened(slices, action.change);
  if (action.type === "guard-dismiss") return slices.guardDismissed === action.status ? slices : { ...slices, guardDismissed: action.status };
  const dialog = slices.guardDialog;
  if (dialog === null) return slices;
  const next = step(dialog, action);
  return next === dialog ? slices : { ...slices, guardDialog: next };
}
