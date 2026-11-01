import { describeError } from "../../cli/describe-error.js";
import type { JournalEntry, Store, StoredRepo } from "../../core/journal/store.types.js";
import { readSnapshot, type Snapshot } from "../../core/snapshot/read-snapshot.js";

export type Snapshots = {
  /** The repositories the store knows now. */
  repos(): StoredRepo[];
  /** The cached snapshot while it is under 2 s old, else a fresh one. Throws for an unknown repository or a failed scan. */
  get(repoId: number): Promise<Snapshot>;
  /** Reads the repository now; callers that overlap share one read. Calls every `onRefresh` listener with the result. */
  refresh(repoId: number): Promise<Snapshot>;
  cached(repoId: number): Snapshot | null;
  /** Why the last scan of the repository failed, or null when it succeeded. */
  error(repoId: number): string | null;
  /** Calls `listener` after every successful refresh, whatever triggered it; returns the unsubscribe function. */
  onRefresh(listener: (snapshot: Snapshot) => void): () => void;
};

const FRESH_MS = 2000;

/**
 * Keeps each repository's last snapshot and the error of its last failed scan. A failed scan records
 * `describeError(e)` (or "scan failed") and rethrows. `now` is the clock.
 */
export function createSnapshots(store: Store, now: () => number = Date.now): Snapshots {
  const snapshots = new Map<number, Snapshot>();
  const flights = new Map<number, Promise<Snapshot>>();
  const errors = new Map<number, string>();
  const listeners = new Set<(snapshot: Snapshot) => void>();

  const rootOf = (repoId: number): string => {
    const repo = store.repos().find((candidate) => candidate.id === repoId);
    if (repo === undefined) throw new Error(`unknown repository ${repoId}`);
    return repo.root;
  };

  const read = async (repoId: number): Promise<Snapshot> => {
    try {
      const snapshot = await readSnapshot(rootOf(repoId), store, now());
      snapshots.set(repoId, snapshot);
      errors.delete(repoId);
      return snapshot;
    } catch (error) {
      errors.set(repoId, describeError(error) ?? "scan failed");
      throw error;
    }
  };

  const notify = (snapshot: Snapshot): void => {
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        process.stderr.write(`git-grove: refresh listener: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
  };

  const refresh = (repoId: number): Promise<Snapshot> => {
    const running = flights.get(repoId);
    if (running !== undefined) return running;
    const flight = read(repoId)
      .then((snapshot) => {
        notify(snapshot);
        return snapshot;
      })
      .finally(() => flights.delete(repoId));
    flights.set(repoId, flight);
    return flight;
  };

  return {
    repos: () => store.repos(),
    async get(repoId) {
      const held = snapshots.get(repoId);
      return held !== undefined && now() - held.readAt < FRESH_MS ? held : refresh(repoId);
    },
    refresh,
    cached: (repoId) => snapshots.get(repoId) ?? null,
    error: (repoId) => errors.get(repoId) ?? null,
    onRefresh(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
