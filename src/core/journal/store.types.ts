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

/** `from` null expects no saved tip; `to` null removes it. */
export type TipSwap = { ref: string; from: Sha | null; to: LastTip | null; at: number; entry: JournalEntry | null };

/**
 * Grove's local database: repositories, each branch's last recorded tip, and the journal of tip changes.
 * `ref` is a branch name; times are epoch milliseconds.
 */
export type Store = {
  repoId(commonDir: string, root: string): number;
  findRepoId(commonDir: string): number | null;
  lastTips(repoId: number): Map<string, LastTip>;
  saveTip(repoId: number, ref: string, sha: Sha, parentSha: Sha, at: number): void;
  /** Applies the swap only while the saved tip is still `from`, recording `entry` in the same transaction. */
  swapTip(repoId: number, swap: TipSwap): { swapped: boolean; entryId: number | null };
  /** Returns the new entry's id, or null when the journal already holds this change. */
  record(repoId: number, entry: JournalEntry): number | null;
  /** `unresolved` keeps `rewritten` and `deleted` entries that are not acked. */
  entries(repoId: number, options?: { unresolved?: boolean }): JournalEntry[];
  ack(repoId: number, entryId: number, at: number): void;
  close(): void;
};
