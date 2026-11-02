import { errorLine } from "../actions/error-line.js";
import type { GuardReceipt, PreparedGuardChange } from "./guard-install.types.js";
import { SettingsChangedError } from "./settings-changed.error.js";
import { writeSettingsFile } from "./write-settings-file.js";

/**
 * Makes a reviewed change (`writeSettingsFile`) and resolves to its receipt; refusals and failures are receipts,
 * never throws. A blocked plan writes nothing; a file that changed since the review is refused. A change that was
 * made offers the opposite change as its undo, planned against the file as it is then.
 */
export async function runGuardChange(prepared: PreparedGuardChange, now: () => number = Date.now): Promise<GuardReceipt> {
  const { plan, edit } = prepared;
  const change = plan.change;
  if (edit === null || plan.blockers.length > 0) return { change, ok: false, refused: true, title: "Not run", lines: plan.blockers, undo: null, at: now() };
  try {
    const { backup } = await writeSettingsFile(edit);
    const lines = backup === null ? [`Created ${edit.path}`] : [`Wrote ${edit.path}`, `The file as it was is in ${backup}`];
    return { change, ok: true, refused: false, title: prepared.done, lines, undo: change === "install" ? "uninstall" : "install", at: now() };
  } catch (error) {
    if (error instanceof SettingsChangedError) return { change, ok: false, refused: true, title: "Changed since you looked", lines: [error.message], undo: null, at: now() };
    return { change, ok: false, refused: false, title: "Stopped: the settings file was not written", lines: [errorLine(error)], undo: null, at: now() };
  }
}
