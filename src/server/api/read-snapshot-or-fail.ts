import type { Snapshot } from "../../core/snapshot/read-snapshot.js";
import { HttpError } from "../http/http.error.js";
import type { ServerContext } from "../server-context.types.js";

/** The repository's snapshot, or a 503 HttpError saying why it could not be scanned. */
export async function readSnapshotOrFail(ctx: ServerContext, repoId: number): Promise<Snapshot> {
  try {
    return await ctx.snapshots.get(repoId);
  } catch {
    throw new HttpError(503, ctx.snapshots.error(repoId) ?? "scan failed");
  }
}
