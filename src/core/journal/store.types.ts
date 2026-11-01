import type { Sha } from "../facts/facts.types.js";
import type { TipChange } from "./classify-tip-change.js";

export type JournalEntry = TipChange & {
  id?: number;
  pinRef: string | null;
  at: number;
  foundLater: boolean;
  acked: boolean;
};

export type LastTip = { sha: Sha; parentSha: Sha };

/** `from` null expects no saved tip; `to` null removes it. `acks` names entries to ack along with the swap. */
export type TipSwap = {
  ref: string;
  from: Sha | null;
  to: LastTip | null;
  at: number;
  entry: JournalEntry | null;
  acks?: readonly number[];
};

export type ActivityKind = "action" | "worktree-added" | "worktree-removed" | "scan-error";

export type ActivityItem = { kind: ActivityKind; branch: string | null; title: string; detail: string; at: number };

export type StoredActivity = ActivityItem & { id: number; repoId: number };

export type StoredRepo = { id: number; commonDir: string; root: string };

/**
 * Grove's local database: repositories, each branch's last recorded tip, the journal of tip changes, and activity.
 * `ref` is a branch name; times are epoch milliseconds.
 */
export type Store = {
  repoId(commonDir: string, root: string): number;
  findRepoId(commonDir: string): number | null;
  repos(): StoredRepo[];
  lastTips(repoId: number): Map<string, LastTip>;
  saveTip(repoId: number, ref: string, sha: Sha, parentSha: Sha, at: number): void;
  /** Applies the swap only while the saved tip is still `from`, recording `entry` and acking `acks` in the same transaction. */
  swapTip(repoId: number, swap: TipSwap): { swapped: boolean; entryId: number | null };
  /** Returns the entry's id. A change the journal already holds (same branch, old and new tip) takes `entry`'s values. */
  record(repoId: number, entry: JournalEntry): number;
  /**
   * Oldest first. `unresolved` keeps `rewritten` and `deleted` entries that are not acked; `after` keeps entries newer by `(at, id)`; `branches` keeps those of the named branches; `limit` keeps the newest that many.
   */
  entries(
    repoId: number,
    options?: { unresolved?: boolean; after?: { at: number; id: number }; branches?: readonly string[]; limit?: number },
  ): JournalEntry[];
  ack(repoId: number, entryId: number, at: number): void;
  /** Returns the item's id. */
  addActivity(repoId: number, item: ActivityItem): number;
  /** Newest first; `repoId` null reads every repository's; `branches` keeps items on those branches. */
  activity(repoId: number | null, limit: number, branches?: readonly string[]): StoredActivity[];
  close(): void;
};
