import type { ActionName, Plan, Receipt, StepEvent } from "../../../src/core/actions/plan.types.js";
import type { RunState } from "../../../src/server/actions/runs.js";
import { DIALOGS, type DialogContext, type FieldValue, type FieldValues } from "./dialog-specs.js";

/**
 * An open dialog. `revision` counts the changes that need a new preview; a preview reply for an older one is
 * dropped. `debounce` says whether the next preview waits for typing to pause. `stage` is `run` once confirmed.
 */
export type DialogState = {
  id: number;
  action: ActionName;
  repoId: number;
  ctx: DialogContext;
  values: FieldValues;
  revision: number;
  debounce: boolean;
  plan: Plan | null;
  planId: string | null;
  planning: boolean;
  error: string | null;
  notice: string | null;
  stage: "review" | "run";
};

/** The latest run: its plan, `runId` once git grove accepted it, its step events and its receipt. `sync` asks for its state to be read. */
export type RunSlice = {
  dialog: number;
  repoId: number;
  action: ActionName;
  ctx: DialogContext;
  planId: string;
  runId: string | null;
  plan: Plan;
  events: StepEvent[];
  receipt: Receipt | null;
  sync: boolean;
  error: string | null;
};

export type PaletteState = { query: string; index: number };

export type DialogSlices = { dialog: DialogState | null; run: RunSlice | null; palette: PaletteState | null; dialogSeq: number };

export type DialogAction =
  | { type: "dialog-open"; action: ActionName; ctx: DialogContext }
  | { type: "dialog-field"; name: string; value: FieldValue }
  | { type: "dialog-pick"; name: string; ids: string[]; on: boolean }
  | { type: "dialog-planned"; dialog: number; revision: number; planId: string; plan: Plan }
  | { type: "dialog-plan-failed"; dialog: number; revision: number; message: string }
  | { type: "dialog-confirm" }
  | { type: "dialog-close" }
  | { type: "dialog-again" }
  | { type: "dialog-undo" }
  | { type: "run-started"; planId: string; runId: string }
  | { type: "run-failed"; planId: string; status: number; message: string }
  | { type: "run-synced"; runId: string; state: RunState }
  | { type: "run-sync-failed"; runId: string; message: string }
  | { type: "run-step"; runId: string; event: StepEvent }
  | { type: "run-receipt"; runId: string; receipt: Receipt }
  | { type: "run-resync" }
  | { type: "palette-open" }
  | { type: "palette-query"; query: string }
  | { type: "palette-move"; delta: number; count: number }
  | { type: "palette-close" };

const EXPIRED = "That preview expired, so grove checked again. Look it over, then confirm.";

function sameValue(a: FieldValue | undefined, b: FieldValue): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, index) => item === b[index]);
  return a === b;
}

function revised(dialog: DialogState, values: FieldValues, debounce: boolean): DialogState {
  const missing = DIALOGS[dialog.action].incomplete?.(values) ?? null;
  return { ...dialog, values, revision: dialog.revision + 1, debounce, planning: missing === null, error: missing, plan: missing === null ? dialog.plan : null, planId: null, notice: null };
}

function opened(slices: DialogSlices, action: ActionName, ctx: DialogContext): DialogSlices {
  const id = slices.dialogSeq + 1;
  const spec = DIALOGS[action];
  const values = spec.initial(ctx);
  const missing = spec.incomplete?.(values) ?? null;
  const dialog: DialogState = {
    id,
    action,
    repoId: ctx.repo.project.id,
    ctx,
    values,
    revision: 0,
    debounce: false,
    plan: null,
    planId: null,
    planning: missing === null,
    error: missing,
    notice: null,
    stage: "review",
  };
  return { dialog, dialogSeq: id, palette: null, run: slices.run?.receipt === null ? slices.run : null };
}

function keyOf(event: StepEvent): string {
  return `${event.index}:${event.state}`;
}

function merged(server: readonly StepEvent[], live: readonly StepEvent[]): StepEvent[] {
  const seen = new Set(server.map(keyOf));
  return [...server, ...live.filter((event) => !seen.has(keyOf(event)))];
}

function picked(dialog: DialogState, name: string): string[] {
  const value = dialog.values[name];
  if (Array.isArray(value)) return value;
  return (dialog.plan?.choices ?? []).filter((choice) => choice.selected).map((choice) => choice.id);
}

function confirmable(dialog: DialogState): dialog is DialogState & { plan: Plan; planId: string } {
  return dialog.stage === "review" && dialog.plan !== null && dialog.planId !== null && !dialog.planning && dialog.error === null && dialog.plan.blockers.length === 0;
}

function withDialog(slices: DialogSlices, change: (dialog: DialogState) => DialogState | null): DialogSlices {
  if (slices.dialog === null) return slices;
  const dialog = change(slices.dialog);
  return dialog === slices.dialog ? slices : { ...slices, dialog };
}

function withRun(slices: DialogSlices, runId: string, change: (run: RunSlice) => RunSlice): DialogSlices {
  if (slices.run === null || slices.run.runId !== runId) return slices;
  const run = change(slices.run);
  return run === slices.run ? slices : { ...slices, run };
}

function confirm(slices: DialogSlices): DialogSlices {
  const { dialog } = slices;
  if (dialog === null || !confirmable(dialog)) return slices;
  const run: RunSlice = {
    dialog: dialog.id,
    repoId: dialog.repoId,
    action: dialog.action,
    ctx: dialog.ctx,
    planId: dialog.planId,
    runId: null,
    plan: dialog.plan,
    events: [],
    receipt: null,
    sync: false,
    error: null,
  };
  return { ...slices, dialog: { ...dialog, stage: "run" }, run };
}

function runFailed(slices: DialogSlices, action: { planId: string; status: number; message: string }): DialogSlices {
  const { run, dialog } = slices;
  if (run === null || run.planId !== action.planId || run.runId !== null) return slices;
  if (dialog === null || dialog.id !== run.dialog || dialog.stage !== "run") return { ...slices, run: null };
  const back: DialogState = { ...dialog, stage: "review" };
  const next = action.status === 410 ? { ...revised(back, back.values, false), notice: EXPIRED } : { ...back, error: action.message, planId: null };
  return { ...slices, run: null, dialog: next };
}

function again(slices: DialogSlices): DialogSlices {
  const { dialog, run } = slices;
  if (dialog === null || dialog.stage !== "run" || run === null || run.receipt === null) return slices;
  return { ...slices, run: null, dialog: revised({ ...dialog, stage: "review", plan: null }, dialog.values, false) };
}

function undo(slices: DialogSlices): DialogSlices {
  const targets = slices.run?.receipt?.undo ?? null;
  if (slices.run === null || targets === null || targets.length === 0) return slices;
  const ctx: DialogContext = { ...slices.run.ctx, level: null, branch: null, worktree: null, targets };
  return opened({ ...slices, run: null }, "restore", ctx);
}

function field(dialog: DialogState, name: string, value: FieldValue): DialogState {
  if (dialog.stage !== "review" || sameValue(dialog.values[name], value)) return dialog;
  return revised(dialog, { ...dialog.values, [name]: value }, true);
}

function pick(dialog: DialogState, name: string, ids: readonly string[], on: boolean): DialogState {
  if (dialog.stage !== "review") return dialog;
  const current = picked(dialog, name);
  const next = on ? [...current, ...ids.filter((id) => !current.includes(id))] : current.filter((id) => !ids.includes(id));
  return field(dialog, name, next);
}

function settled(dialog: DialogState, action: { dialog: number; revision: number }): boolean {
  return dialog.id === action.dialog && dialog.revision === action.revision && dialog.stage === "review" && dialog.planning;
}

/**
 * The dialog, run and palette slices after `action`; pure, and the same object when nothing changed. Opening a
 * dialog closes the palette and the other way round; a run hidden with its dialog keeps going. Confirm takes the
 * plan shown only when nothing is being checked and nothing blocks it. Step and receipt events count only for the
 * current run, and a run's read state is merged with the live events, so steps sent before it was known show too. A
 * run refused because its preview expired goes back to the plan and previews it again, at once.
 */
export function reduceDialog(slices: DialogSlices, action: DialogAction): DialogSlices {
  switch (action.type) {
    case "dialog-open":
      return opened(slices, action.action, action.ctx);
    case "dialog-field":
      return withDialog(slices, (dialog) => field(dialog, action.name, action.value));
    case "dialog-pick":
      return withDialog(slices, (dialog) => pick(dialog, action.name, action.ids, action.on));
    case "dialog-planned":
      return withDialog(slices, (dialog) => (settled(dialog, action) ? { ...dialog, plan: action.plan, planId: action.planId, planning: false, error: null } : dialog));
    case "dialog-plan-failed":
      return withDialog(slices, (dialog) => (settled(dialog, action) ? { ...dialog, plan: null, planId: null, planning: false, error: action.message } : dialog));
    case "dialog-confirm":
      return confirm(slices);
    case "dialog-close":
      return withDialog(slices, () => null);
    case "dialog-again":
      return again(slices);
    case "dialog-undo":
      return undo(slices);
    case "run-started":
      return slices.run?.planId === action.planId && slices.run.runId === null ? { ...slices, run: { ...slices.run, runId: action.runId, sync: true } } : slices;
    case "run-failed":
      return runFailed(slices, action);
    case "run-synced":
      return withRun(slices, action.runId, (run) => ({ ...run, events: merged(action.state.events, run.events), receipt: run.receipt ?? action.state.receipt, sync: false }));
    case "run-sync-failed":
      return withRun(slices, action.runId, (run) => ({ ...run, sync: false, error: run.receipt === null ? action.message : null }));
    case "run-step":
      return withRun(slices, action.runId, (run) => (run.events.some((event) => keyOf(event) === keyOf(action.event)) ? run : { ...run, events: [...run.events, action.event] }));
    case "run-receipt":
      return withRun(slices, action.runId, (run) => (run.receipt === null ? { ...run, receipt: action.receipt, sync: false, error: null } : run));
    case "run-resync":
      return slices.run !== null && slices.run.runId !== null && slices.run.receipt === null && !slices.run.sync ? { ...slices, run: { ...slices.run, sync: true } } : slices;
    case "palette-open":
      return { ...slices, palette: { query: "", index: 0 }, dialog: null };
    case "palette-query":
      return slices.palette === null || slices.palette.query === action.query ? slices : { ...slices, palette: { query: action.query, index: 0 } };
    case "palette-move": {
      if (slices.palette === null) return slices;
      const index = Math.max(0, Math.min(action.count - 1, slices.palette.index + action.delta));
      return index === slices.palette.index ? slices : { ...slices, palette: { ...slices.palette, index } };
    }
    case "palette-close":
      return slices.palette === null ? slices : { ...slices, palette: null };
  }
}
