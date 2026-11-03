import { writeHookCommand } from "../core/guard-install/hook-command.js";
import type { GuardSetup } from "./guard/guard-setup.types.js";

/** Records the guard's Node and bin in `<home>/hook-command` for the plugin's hook; a failure is one line on stderr and never stops the server. */
export async function recordHookCommand(home: string, guard: () => GuardSetup): Promise<void> {
  try {
    const setup = guard();
    await writeHookCommand(home, setup.node, setup.bin);
  } catch (error) {
    process.stderr.write(`git-grove: recording hook-command: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}
