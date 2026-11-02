import { ARM_MS } from "../dialogs/arm-ms.js";
import type { RegionPainter } from "../region-painter.js";
import { guardDialogParts } from "../render/guard-dialog-parts.js";
import type { State, UiAction } from "../state.js";
import type { GuardDialogState } from "./reduce-guard.js";

export type GuardDialogHostDeps = { root: HTMLElement; dispatch(action: UiAction): void; paint: RegionPainter };

export type GuardDialogHost = { paint(state: State, now: number): void; reset(): void };

const SHELL = '<div class="dlg" role="dialog" aria-modal="true" aria-labelledby="dlg-t" tabindex="-1"><header id="dlg-head"></header><div id="dlg-body"></div><footer id="dlg-foot"></footer></div>';

/**
 * Shows the agent guard dialog in `root`, repainting its header, body and footer from state. Like the action dialogs,
 * a plan's confirm is armed 400 ms after it was first painted, and a click confirms the plan id painted on the
 * button. Focus goes to the dialog when it opens, returns to it when the element that had it is repainted away, and
 * moves to Done when the receipt lands.
 */
export function createGuardDialogHost(deps: GuardDialogHostDeps): GuardDialogHost {
  const { root, dispatch } = deps;
  let mounted: number | null = null;
  let arming = "";
  let doneFor = "";
  const part = (id: string): HTMLElement | null => root.querySelector<HTMLElement>(`#${id}`);

  root.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button[data-guard]") : null;
    if (button === null || button.disabled) return;
    switch (button.dataset["guard"]) {
      case "confirm":
        if (button.dataset["plan"] !== undefined) dispatch({ type: "guard-confirm", planId: button.dataset["plan"] });
        return;
      case "close":
        dispatch({ type: "guard-close" });
        return;
      case "undo":
        dispatch({ type: "guard-undo" });
        return;
      case "again":
        dispatch({ type: "guard-again" });
        return;
    }
  });

  const arm = (dialog: GuardDialogState): void => {
    if (dialog.stage !== "review" || dialog.planId === null || dialog.armed === dialog.planId) return;
    const key = `${dialog.id}:${dialog.planId}`;
    const painted = part("dlg-foot")?.querySelector(`[data-plan="${CSS.escape(dialog.planId)}"]`) ?? null;
    if (arming === key || painted === null) return;
    arming = key;
    const { id, planId } = dialog;
    window.setTimeout(() => dispatch({ type: "guard-armed", dialog: id, planId }), ARM_MS);
  };

  return {
    reset() {
      mounted = null;
    },
    paint(state, now) {
      const dialog = state.guardDialog;
      if (dialog === null) return;
      const fresh = mounted !== dialog.id;
      if (fresh) {
        root.innerHTML = SHELL;
        mounted = dialog.id;
      }
      const parts = guardDialogParts(dialog, now);
      const stage = `${dialog.id}:${dialog.stage}`;
      deps.paint(part("dlg-head"), parts.head, stage);
      deps.paint(part("dlg-body"), parts.body, stage);
      deps.paint(part("dlg-foot"), parts.foot, stage);
      arm(dialog);
      const box = root.querySelector<HTMLElement>(".dlg");
      const landed = dialog.stage === "done" && doneFor !== stage;
      if (landed) doneFor = stage;
      if (fresh) box?.focus();
      else if (landed) part("dlg-foot")?.querySelector<HTMLElement>('[data-key="guard:done"]')?.focus({ preventScroll: true });
      else if (!root.contains(document.activeElement)) box?.focus({ preventScroll: true });
    },
  };
}
