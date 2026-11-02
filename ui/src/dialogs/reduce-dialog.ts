import type { ActionName, Choice, Plan, Receipt, StepEvent } from "../../../src/core/actions/plan.types.js";
import type { RunState } from "../../../src/server/actions/runs.js";
import { DIALOGS, type DialogContext, type FieldValue, type FieldValues } from "./dialog-specs.js";

/**
 * An open dialog. `revision` counts the changes that need a new preview; a preview reply for an older one is
 * dropped. `debounce` says whether the next preview waits for typing to pause. `armed` is the plan id whose confirm
 * has been on screen long enough to take; `missing` is what a form still needs; `error` is why the last preview or
 * run failed. `choices` are the last plan's choices, kept when a preview fails. `stage` is `run` once confirmed.
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
  armed: string | null;
  choices: Choice[] | null;
  planning: boolean;
  missing: string | null;
  error: string | null;
  notice: string | null;
  stage: "review" | "run";
};

/**
 * The latest run: its plan, `runId` once git grove accepted it, its step events and its receipt. `sync` counts the
 * reads of its state asked for and `synced` is the newest one answered; one is due while `sync` is ahead.
 */
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
  sync: number;
  synced: number;
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
  | { type: "dialog-armed"; dialog: number; planId: string }
  | { type: "dialog-confirm"; planId: string }
  | { type: "dialog-close" }
  | { type: "dialog-again" }
  | { type: "dialog-undo" }
  | { type: "run-started"; planId: string; runId: string }
  | { type: "run-failed"; planId: string; status: number; message: string }
  | { type: "run-synced"; runId: string; request: number; state: RunState }
  | { type: "run-sync-failed"; runId: string; request: number; message: string }
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
  return {
    ...dialog,
    values,
    revision: dialog.revision + 1,
    debounce,
    planning: missing === null,
    missing,
    error: null,
    plan: missing === null ? dialog.plan : null,
    planId: null,
    armed: null,
    notice: null,
  };
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
    armed: null,
    choices: null,
    planning: missing === null,
    missing,
    error: null,
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

function pickable(choices: readonly Choice[] | null): Set<string> {
  return new Set((choices ?? []).filter((choice) => choice.selectable).map((choice) => choice.id));
}

function picked(dialog: DialogState, name: string): string[] {
  const value = dialog.values[name];
  const allowed = pickable(dialog.choices);
  const current = Array.isArray(value) ? value : (dialog.choices ?? []).filter((choice) => choice.selected).map((choice) => choice.id);
  return current.filter((id) => allowed.has(id));
}

function confirmable(dialog: DialogState, planId: string): dialog is DialogState & { plan: Plan; planId: string } {
  return (
    dialog.stage === "review" &&
    dialog.plan !== null &&
    dialog.planId === planId &&
    dialog.armed === planId &&
    !dialog.planning &&
    dialog.error === null &&
    dialog.missing === null &&
    dialog.plan.blockers.length === 0
  );
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

function confirm(slices: DialogSlices, planId: string): DialogSlices {
  const { dialog } = slices;
  if (dialog === null || !confirmable(dialog, planId)) return slices;
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
    sync: 0,
    synced: 0,
    error: null,
  };
  return { ...slices, dialog: { ...dialog, stage: "run" }, run };
}

function runFailed(slices: DialogSlices, action: { planId: string; status: number; message: string }): DialogSlices {
  const { run, dialog } = slices;
  if (run === null || run.planId !== action.planId || run.runId !== null) return slices;
  if (dialog === null || dialog.id !== run.dialog || dialog.stage !== "run") return { ...slices, run: null };
  const back: DialogState = { ...dialog, stage: "review" };
  const next = action.status === 410 ? { ...revised(back, back.values, false), notice: EXPIRED } : { ...back, error: action.message, planId: null, armed: null };
  return { ...slices, run: null, dialog: next };
}

function again(slices: DialogSlices): DialogSlices {
  const { dialog, run } = slices;
  if (dialog === null) return slices;
  if (dialog.stage === "review") return dialog.error === null ? slices : { ...slices, dialog: revised(dialog, dialog.values, false) };
  if (run === null || run.receipt === null) return slices;
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
  const allowed = pickable(dialog.choices);
  const next = on ? [...current, ...ids.filter((id) => allowed.has(id) && !current.includes(id))] : current.filter((id) => !ids.includes(id));
  return sameValue(current, next) ? dialog : field(dialog, name, next);
}

function settled(dialog: DialogState, action: { dialog: number; revision: number }): boolean {
  return dialog.id === action.dialog && dialog.revision === action.revision && dialog.stage === "review" && dialog.planning;
}

function planned(dialog: DialogState, action: { planId: string; plan: Plan }): DialogState {
  const shown: DialogState = { ...dialog, plan: action.plan, planId: action.planId, armed: null, choices: action.plan.choices, planning: false, error: null };
  const name = DIALOGS[dialog.action].fields.find((candidate) => candidate.kind === "picks")?.name;
  const value = name === undefined ? undefined : dialog.values[name];
  if (name === undefined || !Array.isArray(value)) return shown;
  const kept = picked(shown, name);
  return kept.length === value.length ? shown : { ...revised(shown, { ...shown.values, [name]: kept }, false), plan: action.plan };
}

/**
 * The dialog, run and palette slices after `action`; pure, and the same object when nothing changed. Opening a
 * dialog closes the palette; the palette never opens over a dialog, though it does over a hidden run. Confirm takes
 * the plan only when the id painted on its button is the plan shown, that plan has been armed, nothing is being
 * checked, and nothing is missing, failing or blocking it. Picks keep only choices that can be picked; a picked one
 * that a new plan blocks is dropped and checked again. Step and receipt events count only for the current run, and
 * its read state is merged with the live events. A read asked for while one is in flight is due again afterwards.
 * A run refused because its preview expired goes back to the plan and previews it again at once.
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
      return withDialog(slices, (dialog) => (settled(dialog, action) ? planned(dialog, action) : dialog));
    case "dialog-plan-failed":
      return withDialog(slices, (dialog) => (settled(dialog, action) ? { ...dialog, plan: null, planId: null, armed: null, planning: false, error: action.message } : dialog));
    case "dialog-armed":
      return withDialog(slices, (dialog) =>
        dialog.id === action.dialog && dialog.planId === action.planId && dialog.stage === "review" && dialog.armed !== action.planId ? { ...dialog, armed: action.planId } : dialog,
      );
    case "dialog-confirm":
      return confirm(slices, action.planId);
    case "dialog-close":
      return withDialog(slices, () => null);
    case "dialog-again":
      return again(slices);
    case "dialog-undo":
      return undo(slices);
    case "run-started":
      return slices.run?.planId === action.planId && slices.run.runId === null ? { ...slices, run: { ...slices.run, runId: action.runId, sync: slices.run.sync + 1 } } : slices;
    case "run-failed":
      return runFailed(slices, action);
    case "run-synced":
      return withRun(slices, action.runId, (run) => ({
        ...run,
        events: merged(action.state.events, run.events),
        receipt: run.receipt ?? action.state.receipt,
        synced: Math.max(run.synced, action.request),
      }));
    case "run-sync-failed":
      return withRun(slices, action.runId, (run) => ({ ...run, synced: Math.max(run.synced, action.request), error: run.receipt === null ? action.message : null }));
    case "run-step":
      return withRun(slices, action.runId, (run) => (run.events.some((event) => keyOf(event) === keyOf(action.event)) ? run : { ...run, events: [...run.events, action.event] }));
    case "run-receipt":
      return withRun(slices, action.runId, (run) => (run.receipt === null ? { ...run, receipt: action.receipt, error: null } : run));
    case "run-resync":
      return slices.run !== null && slices.run.runId !== null && slices.run.receipt === null ? { ...slices, run: { ...slices.run, sync: slices.run.sync + 1 } } : slices;
    case "palette-open":
      return slices.dialog !== null ? slices : { ...slices, palette: { query: "", index: 0 } };
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
