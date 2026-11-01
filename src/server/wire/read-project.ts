import type { StoredRepo } from "../../core/journal/store.types.js";
import type { Snapshot } from "../../core/snapshot/read-snapshot.js";
import type { Snapshots } from "../live/snapshots.js";
import { toProject } from "./to-project.js";
import type { WireProject } from "./wire.types.js";

/**
 * The project for `repo` from its cached snapshot, with `error` set when its last scan failed. `snapshot` is null only
 * when the repository has never been scanned successfully.
 */
export async function readProject(snapshots: Snapshots, repo: StoredRepo): Promise<{ project: WireProject; snapshot: Snapshot | null }> {
  try {
    const snapshot = await snapshots.get(repo.id);
    return { project: toProject(repo, snapshot, snapshot.facts.pins.length, snapshots.error(repo.id)), snapshot };
  } catch {
    return { project: toProject(repo, null, 0, snapshots.error(repo.id) ?? "scan failed"), snapshot: null };
  }
}
