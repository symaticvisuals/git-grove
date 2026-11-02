import type { RegionPainter } from "../region-painter.js";
import { dialogParts } from "../render/dialog-parts.js";
import { renderFields } from "../render/render-fields.js";
import type { State, UiAction } from "../state.js";
import { DIALOGS } from "./dialog-specs.js";

export type DialogHostDeps = { root: HTMLElement; dispatch(action: UiAction): void; paint: RegionPainter };

export type DialogHost = { paint(state: State, now: number): void; reset(): void };

const SHELL =
  '<div class="dlg" role="dialog" aria-modal="true" aria-labelledby="dlg-t" tabindex="-1"><header id="dlg-head"></header><div id="dlg-fields"></div><div id="dlg-body"></div><footer id="dlg-foot"></footer></div>';

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function idsOf(input: HTMLInputElement): string[] {
  try {
    const parsed: unknown = JSON.parse(input.dataset["ids"] ?? "[]");
    return isStrings(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Shows the open dialog in `root`. The text and select fields are written once per dialog and stage, so typing is
 * never interrupted; the header, body and footer are repainted from state. Edits, picks and the dialog's buttons are
 * dispatched. On opening, focus goes to the first text field, else the dialog, and returns to the dialog whenever
 * the element that had it is repainted away; a receipt that lands is scrolled into view.
 */
export function createDialogHost(deps: DialogHostDeps): DialogHost {
  const { root, dispatch } = deps;
  let mounted: number | null = null;
  let fieldsFor = "";
  let receiptFor = "";
  const part = (id: string): HTMLElement | null => root.querySelector<HTMLElement>(`#${id}`);

  root.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type === "checkbox") return;
    const name = target.dataset["field"];
    if (name !== undefined) dispatch({ type: "dialog-field", name, value: target.value });
  });
  root.addEventListener("change", (event) => {
    const target = event.target;
    if (target instanceof HTMLSelectElement && target.dataset["field"] !== undefined) {
      dispatch({ type: "dialog-field", name: target.dataset["field"], value: target.value });
      return;
    }
    if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") return;
    const { field, pick } = target.dataset;
    if (field !== undefined) dispatch({ type: "dialog-field", name: field, value: target.checked });
    else if (pick !== undefined) dispatch({ type: "dialog-pick", name: pick, ids: idsOf(target), on: target.checked });
  });
  root.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button[data-dlg]") : null;
    if (button === null || button.disabled) return;
    switch (button.dataset["dlg"]) {
      case "confirm":
        dispatch({ type: "dialog-confirm" });
        return;
      case "close":
        dispatch({ type: "dialog-close" });
        return;
      case "undo":
        dispatch({ type: "dialog-undo" });
        return;
      case "again":
        dispatch({ type: "dialog-again" });
        return;
    }
  });

  return {
    reset() {
      mounted = null;
      fieldsFor = "";
    },
    paint(state, now) {
      const { dialog } = state;
      const parts = dialogParts(state, now);
      if (dialog === null || parts === null) return;
      const fresh = mounted !== dialog.id;
      if (fresh) {
        root.innerHTML = SHELL;
        mounted = dialog.id;
        fieldsFor = "";
      }
      const stage = `${dialog.id}:${dialog.stage}`;
      const fields = part("dlg-fields");
      if (fieldsFor !== stage && fields !== null) {
        fields.innerHTML = dialog.stage === "review" ? renderFields(DIALOGS[dialog.action], dialog.values, dialog.ctx).text : "";
        fieldsFor = stage;
      }
      deps.paint(part("dlg-head"), parts.head, stage);
      deps.paint(part("dlg-body"), parts.body, stage);
      deps.paint(part("dlg-foot"), parts.foot, stage);
      const box = root.querySelector<HTMLElement>(".dlg");
      if (box !== null && receiptFor !== stage && root.querySelector("#dlg-body .receipt") !== null) {
        receiptFor = stage;
        box.scrollTop = box.scrollHeight;
      }
      if (fresh) (root.querySelector<HTMLElement>("#dlg-fields input") ?? box)?.focus();
      else if (!root.contains(document.activeElement)) box?.focus({ preventScroll: true });
    },
  };
}
