import { basename } from "node:path";
import type { RepoFacts } from "../facts/facts.types.js";
import { plural } from "../rules/plural.js";
import type { PinEntry } from "../runner/list-pins.js";
import { branchContext } from "./branch-context.js";
import type { Plan } from "./plan.types.js";

export type Unnamed = { branch: string; pins: PinEntry[] };

const SHOWN = 10;

function when(at: string): string {
  return at.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})\d{2}Z$/, "$1-$2-$3 $4:$5 UTC");
}

/**
 * The blocked restore plan for branches whose pin nobody named and no open alert names: for each, a blocker saying
 * to name one, then the newest 10 pins with their tips and dates, and a line pointing at `pins list` for any older.
 * `commands` holds the restore of each pin shown, and `expects` each branch's tip, so the receipt names the branch.
 */
export function pinChoicePlan(facts: RepoFacts, unnamed: Unnamed[]): Plan {
  const [only] = unnamed.length === 1 ? unnamed : [];
  return {
    action: "restore",
    context: only ? branchContext(facts, only.branch) : basename(facts.root),
    title: `Choose a pin for ${only ? only.branch : `${unnamed.length} branches`}`,
    summary: "No open alert says which pin to go back to, and grove does not guess.",
    confirm: "Restore",
    before: null,
    after: null,
    folders: null,
    choices: null,
    checks: [],
    effects: [],
    commands: unnamed.flatMap(({ branch, pins }) => pins.slice(0, SHOWN).map((pin) => `git grove restore ${branch} ${pin.ref}`)),
    steps: [{ title: "Check nothing moved since you looked", detail: "" }],
    blockers: unnamed.flatMap(({ branch, pins }) => [
      `No open alert says which pin to restore ${branch} to; name one: git grove restore ${branch} <pin-ref>`,
      ...pins.slice(0, SHOWN).map((pin) => `${pin.ref} at ${pin.sha.slice(0, 7)}, pinned ${when(pin.at)}`),
      ...(pins.length > SHOWN ? [`and ${plural(pins.length - SHOWN, "older pin")}: git grove pins list ${branch}`] : []),
    ]),
    note: null,
    undoable: false,
    moves: [],
    expects: unnamed.map(({ branch }) => ({ kind: "tip", branch, sha: facts.branches.find((candidate) => candidate.name === branch)?.tip ?? null })),
    readAt: facts.readAt,
  };
}
