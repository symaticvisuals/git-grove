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

/**
 * Grove's local database: repositories, each branch's last recorded tip, and the journal of tip changes.
 * `ref` is a branch name; times are epoch milliseconds.
 */
export type Store = {
  repoId(commonDir: string, root: string): number;
  lastTips(repoId: number): Map<string, LastTip>;
  saveTip(repoId: number, ref: string, sha: Sha, parentSha: Sha, at: number): void;
  dropTip(repoId: number, ref: string): void;
  /** Returns the new entry's id, or null when the journal already holds this change. */
  record(repoId: number, entry: JournalEntry): number | null;
  /** `unresolved` keeps `rewritten` and `deleted` entries that are not acked. */
  entries(repoId: number, options?: { unresolved?: boolean }): JournalEntry[];
  ack(repoId: number, entryId: number, at: number): void;
  close(): void;
};
