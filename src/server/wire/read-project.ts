import { listPins } from "../../core/runner/list-pins.js";
import type { StoredRepo } from "../../core/journal/store.types.js";
import type { Snapshot } from "../../core/snapshot/read-snapshot.js";
import { unlessGitFails } from "../../core/git/unless-git-fails.js";
import type { Snapshots } from "../live/snapshots.js";
import { toProject } from "./to-project.js";
import type { WireProject } from "./wire.types.js";

/**
 * The project for `repo` from a snapshot read now. A failed scan gives the last snapshot, if any, with `error` set;
 * `snapshot` is null only when the scan failed, so a caller that needs a fresh one can tell.
 */
export async function readProject(snapshots: Snapshots, repo: StoredRepo): Promise<{ project: WireProject; snapshot: Snapshot | null }> {
  const pins = async (): Promise<number> => (await unlessGitFails(listPins(repo.root), [])).length;
  try {
    const snapshot = await snapshots.get(repo.id);
    return { project: toProject(repo, snapshot, await pins(), null), snapshot };
  } catch {
    const error = snapshots.error(repo.id) ?? "scan failed";
    return { project: toProject(repo, snapshots.cached(repo.id), await pins().catch(() => 0), error), snapshot: null };
  }
}
