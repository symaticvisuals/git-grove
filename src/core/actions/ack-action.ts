import type { Sha } from "../facts/facts.types.js";
import { readRepoFacts } from "../facts/read-repo-facts.js";
import { runGit } from "../git/run-git.js";
import { ackAlerts } from "../journal/ack-alerts.js";
import { plural } from "../rules/plural.js";
import type { ActionContext, ActionDef, Prepared } from "./action.types.js";
import { branchContext } from "./branch-context.js";
import { InvalidInputError } from "./invalid-input.error.js";
import type { Plan } from "./plan.types.js";

function parseBranch(raw: unknown): string {
  const branch = typeof raw === "object" && raw !== null && "branch" in raw ? raw.branch : undefined;
  if (typeof branch !== "string" || branch === "") throw new InvalidInputError("ack takes { branch }");
  return branch;
}

function oldCommits(count: number, verb: { one: string; many: string }): string {
  return count === 1 ? `The old commit ${verb.one}` : `The ${count} old commits ${verb.many}`;
}

async function ownCount(cwd: string, parentTip: Sha, tip: Sha): Promise<number> {
  return Number((await runGit(["rev-list", "--count", `${parentTip}..${tip}`], { cwd })).stdout.trim());
}

async function prepare(ctx: ActionContext, raw: unknown): Promise<Prepared> {
  const branch = parseBranch(raw);
  const facts = await readRepoFacts(ctx.root);
  const repoId = ctx.store.findRepoId(facts.commonDir);
  const open = repoId === null ? [] : ctx.store.entries(repoId, { unresolved: true }).filter((entry) => entry.branch === branch);
  const tip = facts.branches.find((candidate) => candidate.name === branch)?.tip ?? null;
  const parent = facts.edges.find((edge) => edge.branch === branch)?.parent;
  const parentTip = facts.branches.find((candidate) => candidate.name === parent)?.tip ?? facts.trunk.sha;
  const own = tip === null ? 0 : await ownCount(facts.root, parentTip, tip);
  const lost = new Set(open.flatMap((entry) => entry.lost)).size;

  const plan: Plan = {
    action: "ack",
    context: branchContext(facts, branch),
    title: `Keep the squash on ${branch}`,
    summary: "Nothing in git changes. Only the alert goes away.",
    confirm: "Keep the squash",
    before: null,
    after: null,
    folders: null,
    choices: null,
    checks: [],
    effects: [
      tip === null ? "The branch stays deleted." : `The branch keeps ${own === 1 ? "its single commit" : `its ${own} commits`}.`,
      `${oldCommits(lost, { one: "stays", many: "stay" })} pinned, in case you change your mind.`,
      "If the same thing happens again, grove tells you again.",
    ],
    commands: [`git grove ack ${branch}`],
    steps: [
      { title: "Check nothing moved since you looked", detail: tip === null ? `${branch} still deleted` : `Still at ${tip.slice(0, 7)}` },
      { title: "Mark the change as intended", detail: `${plural(open.length, "alert")} cleared` },
    ],
    blockers: open.length === 0 ? [`Nothing to acknowledge on ${branch}`] : [],
    note: "Nothing in git changes.",
    undoable: false,
    moves: [],
    expects: [{ kind: "tip", branch, sha: tip }],
    readAt: facts.readAt,
  };

  return {
    plan,
    async execute(run) {
      const id = ctx.store.repoId(run.facts.commonDir, run.facts.root);
      let acked = 0;
      await run.step(run.firstStep, async () => {
        acked = ackAlerts(ctx.store, id, branch);
        return `${plural(acked, "alert")} cleared`;
      });
      return {
        ok: true,
        title: `Kept the squash on ${branch}`,
        lines: [`${plural(acked, "alert")} cleared`, `${oldCommits(lost, { one: "is", many: "are" })} still pinned`],
        undo: null,
      };
    },
  };
}

/**
 * Marks a branch's open rewrite and deletion alerts as intended: `{ branch }`. Changes nothing in git, and is
 * blocked when the branch has no open alert. Refuses at run time when the branch moved since the plan.
 */
export const ackAction: ActionDef = { name: "ack", prepare };
