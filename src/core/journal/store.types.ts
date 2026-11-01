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

/**
 * Grove's local database: repositories, each branch's last recorded tip, and the journal of tip changes.
 * `ref` is a branch name; times are epoch milliseconds.
 */
export type Store = {
  repoId(commonDir: string, root: string): number;
  findRepoId(commonDir: string): number | null;
  lastTips(repoId: number): Map<string, LastTip>;
  saveTip(repoId: number, ref: string, sha: Sha, parentSha: Sha, at: number): void;
  /** Applies the swap only while the saved tip is still `from`, recording `entry` and acking `acks` in the same transaction. */
  swapTip(repoId: number, swap: TipSwap): { swapped: boolean; entryId: number | null };
  /** Returns the entry's id. A change the journal already holds (same branch, old and new tip) takes `entry`'s values. */
  record(repoId: number, entry: JournalEntry): number;
  /** `unresolved` keeps `rewritten` and `deleted` entries that are not acked. */
  entries(repoId: number, options?: { unresolved?: boolean }): JournalEntry[];
  ack(repoId: number, entryId: number, at: number): void;
  close(): void;
};
