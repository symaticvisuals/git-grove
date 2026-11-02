import { errorLine } from "../actions/error-line.js";
import type { GuardReceipt, PreparedGuardChange } from "./guard-install.types.js";
import { SettingsChangedError } from "./settings-changed.error.js";
import { SettingsRefusedError } from "./settings-refused.error.js";
import { type WrittenSettings, writeSettingsFile } from "./write-settings-file.js";

function linesOf(path: string, written: WrittenSettings): string[] {
  const { backup, original } = written;
  if (backup === null || original === null) return [`Created ${path}`];
  const kept = original.written ? `It is also in ${original.path}, which grove never overwrites` : `The file from before grove first changed it is in ${original.path}`;
  return [`Wrote ${path}`, `The file as it was is in ${backup}`, kept];
}

/**
 * Makes a reviewed change (`writeSettingsFile`) and resolves to its receipt; refusals and failures are receipts,
 * never throws. A blocked plan writes nothing; a file that changed since the review, or that grove now leaves alone,
 * is refused. A change that was made offers the opposite change as its undo, planned against the file as it is then;
 * after an update that is an uninstall.
 */
export async function runGuardChange(prepared: PreparedGuardChange, now: () => number = Date.now): Promise<GuardReceipt> {
  const { plan, edit, updated } = prepared;
  const change = plan.change;
  const refused = (title: string, lines: string[]): GuardReceipt => ({ change, updated, ok: false, refused: true, title, lines, undo: null, at: now() });
  if (edit === null || plan.blockers.length > 0) return refused("Not run", plan.blockers);
  try {
    const written = await writeSettingsFile(edit);
    return { change, updated, ok: true, refused: false, title: prepared.done, lines: linesOf(edit.path, written), undo: change === "install" ? "uninstall" : "install", at: now() };
  } catch (error) {
    if (error instanceof SettingsChangedError) return refused("Changed since you looked", [error.message]);
    if (error instanceof SettingsRefusedError) return refused("Not run", [error.message]);
    return { change, updated, ok: false, refused: false, title: "Stopped: the settings file was not written", lines: [errorLine(error)], undo: null, at: now() };
  }
}
