import { createHash } from "node:crypto";
import type { WireRepoView } from "../wire/wire.types.js";

/** A SHA-1 of `view` with `project.scannedAt` left out, so two reads that found the same things have the same digest. */
export function digestOf(view: WireRepoView): string {
  const stable = { ...view, project: { ...view.project, scannedAt: null } };
  return createHash("sha1").update(JSON.stringify(stable)).digest("hex");
}
