import { lockedRefusal } from "../../core/actions/locked-refusal.js";
import { readRepoFacts } from "../../core/facts/read-repo-facts.js";
import { alertPin } from "../../core/journal/alert-pin.js";
import { openStore } from "../../core/journal/open-store.js";
import { settleRestoredTip } from "../../core/journal/settle-restored-tip.js";
import { plural } from "../../core/rules/plural.js";
import { RepoLockedError } from "../../core/runner/repo-locked.error.js";
import { restore } from "../../core/runner/restore.js";
import type { RestoreResult } from "../../core/runner/restore-held.js";
import type { CliIo } from "../cli-io.types.js";
import { renderReceipt } from "../render-receipt.js";

function describe(branch: string, result: RestoreResult): string {
  const restored = `restored ${branch} at ${result.to.slice(0, 7)} from ${result.pinRef} (${plural(result.commitsBack, "commit")} back)`;
  if (result.kind === "created") return restored;
  return `${restored}\nprevious tip ${result.from.slice(0, 7)} pinned at ${result.pinnedCurrent}`;
}

/**
 * Runs `git grove restore <branch> [<pin-ref>]`: moves the branch back to the pin after pinning its current tip,
 * or recreates a deleted branch there, and records the result in the journal as seen. Without a pin ref it takes
 * the pin of the branch's newest unresolved alert, else the branch's newest pin.
 * The store is opened first, so a store that cannot be opened leaves the branch untouched. While another grove action
 * holds the repo lock it prints the same refusal as `rm` and `restack` and exits 1.
 */
export async function restoreCommand(io: CliIo, branch: string, pinRef: string | undefined): Promise<number> {
  const facts = await readRepoFacts(io.cwd);
  const store = openStore();
  try {
    const result = await restore(facts.root, branch, pinRef ?? alertPin(store, facts, branch));
    io.out(`${describe(branch, result)}\n`);
    await settleRestoredTip(store, facts, branch, result.to);
  } catch (error) {
    if (!(error instanceof RepoLockedError)) throw error;
    const refusal = lockedRefusal(error.lockPath);
    io.out(renderReceipt({ action: "restore", ok: false, refused: true, ...refusal, pins: [], undo: null, at: Date.now() }));
    return 1;
  } finally {
    store.close();
  }
  return 0;
}
