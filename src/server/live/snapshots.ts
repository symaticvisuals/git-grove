import { join } from "node:path";
import { describeError } from "../../core/describe-error.js";
import type { JournalEntry, Store, StoredRepo } from "../../core/journal/store.types.js";
import { readSnapshot, type Snapshot } from "../../core/snapshot/read-snapshot.js";
import { lockBlocksScan } from "./lock-blocks-scan.js";

export type RefreshListener = (snapshot: Snapshot, delivered: JournalEntry[]) => void;

export type Snapshots = {
  /** The repositories the store knows now; snapshots of any other are dropped. */
  repos(): StoredRepo[];
  /**
   * The cached snapshot, however old: one older than 2 s starts a background refresh, unless a running process holds
   * the repository's `grove.lock` (`lockBlocksScan`). With no cache it waits for a scan, and rethrows a scan that
   * failed under 5 s ago. Throws for an unknown repository.
   */
  get(repoId: number): Promise<Snapshot>;
  /**
   * Reads the repository now; callers that overlap share one read. With `force` it waits for a read in progress and
   * runs one more, so changes made while that read ran are seen. Calls every `onRefresh` listener with the result.
   */
  refresh(repoId: number, options?: { force?: boolean }): Promise<Snapshot>;
  cached(repoId: number): Snapshot | null;
  /** Resolves once no read of the repository is running or queued, whether it succeeded or not. */
  idle(repoId: number): Promise<void>;
  /** Why the last scan of the repository failed, or null when it succeeded. */
  error(repoId: number): string | null;
  /**
   * Calls `listener` after every successful refresh with the snapshot and `delivered`: the journal entries newer than
   * the repository's delivery cursor, by `(at, id)` so a re-opened entry arrives again, so entries from a failed scan or another process's `status` still arrive once.
   * Returns the unsubscribe function.
   */
  onRefresh(listener: RefreshListener): () => void;
};

const FRESH_MS = 2000;
const FAILURE_MS = 5000;
const MAX_SCANS = 2;

type Cursor = { at: number; id: number };

function newest(entries: JournalEntry[], from: Cursor): Cursor {
  let top = from;
  for (const { at, id = 0 } of entries) if (at > top.at || (at === top.at && id > top.id)) top = { at, id };
  return top;
}

type Flight = { running: Promise<Snapshot>; queued: Promise<Snapshot> | null };

/**
 * Keeps each repository's last snapshot, the error of its last failed scan and its delivery cursor, and runs at most
 * two scans at once. A failed scan records `describeError(e)` (or "scan failed") and rethrows. `now` is the clock;
 * `read` is the scan.
 */
export function createSnapshots(store: Store, now: () => number = Date.now, read: typeof readSnapshot = readSnapshot): Snapshots {
  const snapshots = new Map<number, Snapshot>();
  const flights = new Map<number, Flight>();
  const failures = new Map<number, { message: string; at: number }>();
  const cursors = new Map<number, Cursor>();
  const listeners = new Set<RefreshListener>();
  const waiting: (() => void)[] = [];
  let scanning = 0;

  const slot = async (): Promise<void> => {
    if (scanning < MAX_SCANS) {
      scanning += 1;
      return;
    }
    await new Promise<void>((resolve) => waiting.push(resolve));
  };
  const release = (): void => {
    const next = waiting.shift();
    if (next === undefined) scanning -= 1;
    else next();
  };

  const repos = (): StoredRepo[] => {
    const all = store.repos();
    const known = new Set(all.map((repo) => repo.id));
    for (const map of [snapshots, failures, cursors]) {
      for (const id of map.keys()) if (!known.has(id)) map.delete(id);
    }
    return all;
  };

  const notify = (snapshot: Snapshot, delivered: JournalEntry[]): void => {
    for (const listener of listeners) {
      try {
        listener(snapshot, delivered);
      } catch (error) {
        process.stderr.write(`git-grove: refresh listener: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
  };

  const scan = async (repoId: number): Promise<Snapshot> => {
    const repo = repos().find((candidate) => candidate.id === repoId);
    if (repo === undefined) throw new Error(`unknown repository ${repoId}`);
    if (!cursors.has(repoId)) cursors.set(repoId, newest(store.entries(repoId), { at: -1, id: 0 }));
    await slot();
    try {
      const snapshot = await read(repo.root, store, now());
      snapshots.set(repoId, snapshot);
      failures.delete(repoId);
      const cursor = cursors.get(repoId) ?? { at: -1, id: 0 };
      const delivered = store.entries(repoId, { after: cursor });
      cursors.set(repoId, newest(delivered, cursor));
      notify(snapshot, delivered);
      return snapshot;
    } catch (error) {
      failures.set(repoId, { message: describeError(error) ?? "scan failed", at: now() });
      throw error;
    } finally {
      release();
    }
  };

  const begin = (repoId: number): Promise<Snapshot> => {
    const flight: Flight = { running: scan(repoId), queued: null };
    flights.set(repoId, flight);
    const clear = (): void => {
      if (flights.get(repoId) === flight) flights.delete(repoId);
    };
    flight.running.then(clear, clear);
    return flight.running;
  };

  const locked = async (repoId: number): Promise<boolean> => {
    const repo = repos().find((candidate) => candidate.id === repoId);
    return repo !== undefined && (await lockBlocksScan(join(repo.commonDir, "grove.lock")));
  };

  const refresh = (repoId: number, options: { force?: boolean } = {}): Promise<Snapshot> => {
    const flight = flights.get(repoId);
    if (flight === undefined) return begin(repoId);
    if (options.force !== true) return flight.running;
    flight.queued ??= flight.running
      .catch(() => undefined)
      .then(() => flights.get(repoId)?.running ?? begin(repoId));
    return flight.queued;
  };

  return {
    repos,
    async get(repoId) {
      const held = snapshots.get(repoId);
      if (held !== undefined) {
        if (now() - held.readAt >= FRESH_MS && !(await locked(repoId))) refresh(repoId).catch(() => undefined);
        return held;
      }
      const failure = failures.get(repoId);
      if (failure !== undefined && now() - failure.at < FAILURE_MS) throw new Error(failure.message);
      return refresh(repoId);
    },
    refresh,
    cached: (repoId) => snapshots.get(repoId) ?? null,
    async idle(repoId) {
      for (let flight = flights.get(repoId); flight !== undefined; flight = flights.get(repoId)) {
        await (flight.queued ?? flight.running).catch(() => undefined);
      }
    },
    error: (repoId) => failures.get(repoId)?.message ?? null,
    onRefresh(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
