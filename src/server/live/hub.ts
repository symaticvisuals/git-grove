import { join, relative } from "node:path";
import { describeError } from "../../core/describe-error.js";
import type { ActivityItem as StoredItem, Store, StoredRepo } from "../../core/journal/store.types.js";
import type { Snapshot } from "../../core/snapshot/read-snapshot.js";
import { toActivityItem } from "../wire/to-activity-item.js";
import { toProject } from "../wire/to-project.js";
import { toRepoView } from "../wire/to-repo-view.js";
import { lockBlocksScan } from "./lock-blocks-scan.js";
import { digestOf } from "./digest-of.js";
import type { ServerEvent } from "./server-event.types.js";
import type { Snapshots } from "./snapshots.js";
import { watchRepo } from "./watch-repo.js";

export type Hub = {
  /** Reads `repoId` (every repository when omitted) while a running process holds `grove.lock` (a dead pid does not count), which the lock's removal retries. Failures become one `scan-error` activity per distinct message. */
  scan(repoId?: number): Promise<void>;
  /** Calls `listener` for every event; `onClose` runs when the hub closes. Returns the unsubscribe function. */
  subscribe(listener: (event: ServerEvent) => void, onClose?: () => void): () => void;
  publish(event: ServerEvent): void;
  subscribers(): number;
  /** Stops every watcher and timer, and tells subscribers the stream is over. */
  close(): void;
};

export type HubOptions = { snapshots: Snapshots; store: Store; debounceMs?: number | undefined; pollMs?: number | undefined };

type Watched = { commonDir: string; stop(): void };

/**
 * Scans every repository once at creation, to set the baselines, then watches every repository the store knows (and re-reads the list each poll) and turns each refresh into events:
 * a `digest` when the repository's view changed, an `activity` for each journal entry delivered, and
 * `worktree-added` / `worktree-removed` activity for worktrees that came or went since the previous refresh.
 */
export function createHub(options: HubOptions): Hub {
  const { snapshots, store } = options;
  const listeners = new Map<(event: ServerEvent) => void, (() => void) | undefined>();
  const watched = new Map<number, Watched>();
  const digests = new Map<number, string>();
  const worktreePaths = new Map<number, Set<string>>();
  const scanErrors = new Map<number, string>();
  let closed = false;

  const publish = (event: ServerEvent): void => {
    for (const listener of [...listeners.keys()]) {
      try {
        listener(event);
      } catch (error) {
        process.stderr.write(`git-grove: event listener: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
  };

  const record = (repoId: number, item: StoredItem): void => {
    const id = store.addActivity(repoId, item);
    publish({ type: "activity", item: toActivityItem({ ...item, id, repoId }, repoId) });
  };

  const scan = async (repoId?: number): Promise<void> => {
    if (closed) return;
    const repos = snapshots.repos().filter((repo) => repoId === undefined || repo.id === repoId);
    await Promise.all(
      repos.map(async (repo) => {
        if (await lockBlocksScan(join(repo.commonDir, "grove.lock"))) return;
        try {
          await snapshots.refresh(repo.id, { force: true });
          scanErrors.delete(repo.id);
        } catch (error) {
          const message = describeError(error) ?? (error instanceof Error ? error.message : "scan failed");
          if (scanErrors.get(repo.id) === message || closed) return;
          scanErrors.set(repo.id, message);
          record(repo.id, { kind: "scan-error", branch: null, title: "Could not read the repository", detail: message, at: Date.now() });
        }
      }),
    );
  };

  const background = (repoId?: number): void => {
    scan(repoId).catch(() => undefined);
  };

  const sync = (): void => {
    if (closed) return;
    const repos = snapshots.repos();
    const known = new Set(repos.map((repo) => repo.id));
    for (const [id, entry] of watched) {
      if (known.has(id)) continue;
      entry.stop();
      watched.delete(id);
      for (const map of [digests, worktreePaths, scanErrors]) map.delete(id);
    }
    for (const repo of repos) {
      const held = watched.get(repo.id);
      if (held?.commonDir === repo.commonDir) continue;
      held?.stop();
      const watcher = watchRepo(repo.commonDir, () => background(repo.id), { debounceMs: options.debounceMs, pollMs: options.pollMs });
      watched.set(repo.id, { commonDir: repo.commonDir, stop: watcher.close });
    }
  };

  const noteWorktrees = (repo: StoredRepo, snapshot: Snapshot): void => {
    const current = new Map(snapshot.facts.worktrees.map((worktree) => [worktree.path, worktree]));
    const previous = worktreePaths.get(repo.id);
    worktreePaths.set(repo.id, new Set(current.keys()));
    if (previous === undefined) return;
    const label = (path: string): string => relative(repo.root, path) || ".";
    for (const [path, worktree] of current) {
      if (!previous.has(path)) {
        record(repo.id, { kind: "worktree-added", branch: worktree.branch, title: `Worktree added at ${label(path)}`, detail: path, at: snapshot.readAt });
      }
    }
    for (const path of previous) {
      if (!current.has(path)) {
        record(repo.id, { kind: "worktree-removed", branch: null, title: `Worktree removed from ${label(path)}`, detail: path, at: snapshot.readAt });
      }
    }
  };

  const unsubscribeRefresh = snapshots.onRefresh((snapshot, delivered) => {
    const repo = snapshots.repos().find((candidate) => candidate.id === snapshot.repoId);
    if (repo === undefined || closed) return;
    sync();
    const view = toRepoView(toProject(repo, snapshot, snapshot.facts.pins.length, null), snapshot, snapshot.facts.pins.length);
    const digest = digestOf(view);
    if (digests.get(repo.id) !== digest) {
      digests.set(repo.id, digest);
      publish({ type: "digest", repoId: repo.id, digest, at: snapshot.readAt });
    }
    for (const entry of delivered) publish({ type: "activity", item: toActivityItem(entry, repo.id) });
    noteWorktrees(repo, snapshot);
  });

  sync();
  background();
  const resync = setInterval(sync, options.pollMs ?? 30_000);
  resync.unref();

  return {
    scan,
    publish,
    subscribers: () => listeners.size,
    subscribe(listener, onClose) {
      listeners.set(listener, onClose);
      return () => void listeners.delete(listener);
    },
    close() {
      if (closed) return;
      closed = true;
      clearInterval(resync);
      unsubscribeRefresh();
      for (const entry of watched.values()) entry.stop();
      watched.clear();
      const endings = [...listeners.values()];
      listeners.clear();
      for (const ending of endings) ending?.();
    },
  };
}
