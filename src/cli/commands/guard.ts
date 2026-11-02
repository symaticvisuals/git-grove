import { describeError } from "../../core/describe-error.js";
import type { GuardContext } from "../../core/guard/guard-activity.js";
import type { GuardDecision } from "../../core/guard/guard-decision.types.js";
import type { GuardInput } from "../../core/guard/evaluate-command-line.js";
import type { CliIo } from "../cli-io.types.js";
import { readHookInput } from "../read-hook-input.js";

/** What the guard runs: the evaluation, the activity recorder, the agent's home folder and the deadline. */
export type GuardDeps = {
  evaluate: (input: GuardInput) => Promise<GuardDecision>;
  record: (decision: GuardDecision, context: GuardContext) => Promise<void>;
  home: string;
  deadlineMs: number;
};

const ALLOW = 0;
const BLOCK = 2;
const LATE = Symbol("late");

function reasonOf(error: unknown): string {
  const line = describeError(error) ?? (error instanceof Error ? error.message : String(error));
  return (line.split("\n")[0] ?? "").replace(/^git-grove: /, "");
}

function allowing(io: CliIo, reason: string): number {
  io.err(`git-grove guard: could not check (${reason}); allowing\n`);
  return ALLOW;
}

async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | typeof LATE> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<typeof LATE>((resolve) => {
    timer = setTimeout(() => resolve(LATE), ms);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs `git grove guard --claude` on a `PreToolUse` hook's stdin: exits 2 with the reason on stderr to block, and 0
 * with nothing on stdout to allow. A tool other than Bash, or no command, is allowed silently. It fails open: stdin
 * that is not the hook's JSON, an error inside grove, or an evaluation past `deadlineMs` allows with one warning line,
 * and the deadline stops the git calls still running. A line the guard cannot read is allowed with one line saying so.
 * Blocks and new pins are recorded as activity, after the answer is written.
 */
export async function guardCommand(io: CliIo, stdin: string, deps: GuardDeps): Promise<number> {
  const input = readHookInput(stdin);
  if (input === null) return allowing(io, "stdin is not a hook's JSON");
  if (input.toolName !== "Bash" || input.command === null || input.command.trim() === "") return ALLOW;

  const stop = new AbortController();
  let decision: GuardDecision | typeof LATE;
  try {
    const evaluation = deps.evaluate({ command: input.command, cwd: input.cwd ?? io.cwd, home: deps.home, signal: stop.signal });
    decision = await withDeadline(evaluation, deps.deadlineMs);
  } catch (error) {
    return allowing(io, reasonOf(error));
  }
  if (decision === LATE) {
    stop.abort();
    return allowing(io, `took longer than ${deps.deadlineMs / 1000} s`);
  }

  if (decision.verdict === "block") io.err(`${decision.message}\n`);
  else if (decision.unchecked) io.err("git grove cannot check this command\n");
  await deps.record(decision, { sessionId: input.sessionId, command: input.command }).catch(() => undefined);
  return decision.verdict === "block" ? BLOCK : ALLOW;
}
