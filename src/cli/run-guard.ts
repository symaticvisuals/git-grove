import { homedir } from "node:os";
import { text } from "node:stream/consumers";
import { BOUND_NOTICE } from "../core/guard/bound-notice.js";
import { evaluateCommandLine } from "../core/guard/evaluate-command-line.js";
import type { CliIo } from "./cli-io.types.js";
import { guardCommand } from "./commands/guard.js";
import { recordGuardActivity } from "./record-guard-activity.js";
import { trustsKnownBare } from "./trusts-known-bare.js";

const DEADLINE_MS = 3000;
const USAGE = `Usage: git grove guard --claude
  the agent guard, run by a Claude Code PreToolUse hook: reads the hook's JSON on stdin,
  exits 2 with the reason on stderr to block a command, 0 to allow it
  (git grove install-guard prints the hook to add)
git grove guard --announce
  tells a new Claude Code session that this agent is bounded by the guard
`;

/**
 * Runs `git grove guard <args>`, the hook entry `bin.ts` loads without the rest of the CLI: with `--claude` it reads
 * the hook's JSON from stdin and resolves to 0 or 2; anything else prints its usage and resolves to 1.
 */
export async function runGuard(args: readonly string[], io: CliIo): Promise<number> {
  if (args.length === 1 && args[0] === "--announce") {
    io.out(`${JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: BOUND_NOTICE } })}\n`);
    return 0;
  }
  if (args.length !== 1 || args[0] !== "--claude") {
    io.err(USAGE);
    return 1;
  }
  const stdin = await text(process.stdin);
  return guardCommand(io, stdin, {
    evaluate: (input) => evaluateCommandLine({ ...input, trustsBare: trustsKnownBare }),
    record: recordGuardActivity,
    home: homedir(),
    deadlineMs: DEADLINE_MS,
  });
}
