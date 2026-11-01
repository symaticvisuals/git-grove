import type { RescuedFile } from "./verify-copies.js";

/** A receipt line for a file copied to main: `Copied <from> to main`, plus `as <to>` when it took another name. */
export function copiedLine(copy: RescuedFile): string {
  return copy.to === copy.from ? `Copied ${copy.from} to main` : `Copied ${copy.from} to main as ${copy.to}`;
}
