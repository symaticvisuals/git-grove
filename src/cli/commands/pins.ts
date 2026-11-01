import { readRepoFacts } from "../../core/facts/read-repo-facts.js";
import { listPins } from "../../core/runner/list-pins.js";
import type { CliIo } from "../cli-io.types.js";

/** Runs `git grove pins list [<branch>]`: one `<ref>  <short sha>` line per pin, newest first. */
export async function pinsCommand(io: CliIo, branch: string | undefined): Promise<number> {
  const facts = await readRepoFacts(io.cwd);
  for (const pin of await listPins(facts.root, branch)) io.out(`${pin.ref}  ${pin.sha.slice(0, 7)}\n`);
  return 0;
}
