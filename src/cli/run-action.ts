import type { ActionContext } from "../core/actions/action.types.js";
import type { ActionName } from "../core/actions/plan.types.js";
import { prepareAction } from "../core/actions/registry.js";
import { runPrepared } from "../core/actions/run-prepared.js";
import { readRepoFacts } from "../core/facts/read-repo-facts.js";
import { openStore } from "../core/journal/open-store.js";
import type { CliIo } from "./cli-io.types.js";
import { renderPlan } from "./render-plan.js";
import { renderReceipt } from "./render-receipt.js";
import { renderStepEvent } from "./render-step-event.js";

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Prepares an action in the repository `io.cwd` is in, prints its plan and runs it in-process, printing each step and
 * then the receipt. Exits 3 when the plan has blockers, 0 after `dryRun` or a run that finished, 1 when the run was
 * refused or stopped. With `json` nothing but one JSON document is printed: the plan with `dryRun` or blockers,
 * otherwise the receipt.
 */
export async function runActionCommand(
  io: CliIo,
  name: ActionName,
  raw: unknown,
  options: { dryRun: boolean; json: boolean },
): Promise<number> {
  const facts = await readRepoFacts(io.cwd);
  const store = openStore();
  try {
    const ctx: ActionContext = { root: facts.root, store, now: () => Date.now() };
    const prepared = await prepareAction(name, ctx, raw);
    const { plan } = prepared;
    const blocked = plan.blockers.length > 0;
    if (options.json && (options.dryRun || blocked)) io.out(json(plan));
    if (!options.json) io.out(renderPlan(plan));
    if (blocked) return 3;
    if (options.dryRun) return 0;
    if (!options.json) io.out("\n");
    const receipt = await runPrepared(ctx, prepared, (event) => {
      if (!options.json) io.out(renderStepEvent(plan, event));
    });
    io.out(options.json ? json(receipt) : `\n${renderReceipt(receipt)}`);
    return receipt.ok ? 0 : 1;
  } finally {
    store.close();
  }
}
