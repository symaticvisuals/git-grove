import { displayPath } from "../actions/display-path.js";
import type { ActivityItem } from "../journal/store.types.js";
import type { GuardDecision, GuardSubject } from "./guard-decision.types.js";

/** Who asked and what they ran: the agent's session id and the whole command line. */
export type GuardContext = { sessionId: string | null; command: string };

/** An activity row for the repository whose common git dir is `commonDir`. */
export type GuardActivity = { commonDir: string; item: ActivityItem };

const COMMAND_LENGTH = 200;

function shortCommand(command: string): string {
  const flat = command.replace(/\s+/g, " ").trim();
  return flat.length > COMMAND_LENGTH ? `${flat.slice(0, COMMAND_LENGTH - 1)}…` : flat;
}

function detail(what: string, subject: GuardSubject, context: GuardContext): string {
  const session = context.sessionId === null ? [] : [`session ${context.sessionId}`];
  return [what, displayPath(subject.root, subject.worktree), ...session, `$ ${shortCommand(context.command)}`].join(" · ");
}

/**
 * The activity rows a guard decision leaves: one for a block, and one for each pin it created (a reused pin made
 * nothing new). Each names the worktree, the session and the command, cut to 200 characters. An allowed command that
 * pinned nothing leaves none. Rows use the `action` kind, which every version of the dashboard reads.
 */
export function guardActivity(decision: GuardDecision, context: GuardContext, at: number): GuardActivity[] {
  if (decision.verdict === "block") {
    const { subject } = decision;
    if (subject === null) return [];
    const reason = (decision.message.split("\n")[0] ?? "").replace(/^git grove blocked: /, "").replace(/[.:]$/, "");
    const item: ActivityItem = { kind: "action", branch: subject.branch, title: `Guard blocked ${decision.verb}`, detail: detail(reason, subject, context), at };
    return [{ commonDir: subject.commonDir, item }];
  }
  return decision.pins
    .filter((pinned) => !pinned.reused)
    .map((pinned) => ({
      commonDir: pinned.subject.commonDir,
      item: { kind: "action", branch: pinned.branch, title: `Guard pinned ${pinned.branch} before ${pinned.verb}`, detail: detail(pinned.ref, pinned.subject, context), at },
    }));
}
