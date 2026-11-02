import type { RepoFacts, Sha } from "../../facts/facts.types.js";
import { resolveCommit } from "../../git/resolve-commit.js";
import { runGit } from "../../git/run-git.js";
import { findFeature } from "../../stacks/find-feature.js";
import { readStackFacts } from "../../stacks/read-stack-facts.js";
import type { ActionContext } from "../action.types.js";
import { busyIn } from "../../facts/busy-in.js";
import { displayPath } from "../display-path.js";
import { holderIn } from "../../facts/holder-in.js";
import { orderRestack, type RestackMove } from "./order-restack.js";
import type { RestackLevel, RestackRead } from "./restack.types.js";
import { rewrittenLevels } from "./rewritten-levels.js";

/** `first` adds the checks made once per run; `movedTips` are the tips this run gave the levels it moved. */
export type RecheckInput = {
  level: RestackLevel;
  first: boolean;
  fresh: RepoFacts;
  pins: Map<string, string>;
  movedTips: Map<string, Sha>;
};

function short(sha: Sha | null): string {
  return sha === null ? "nothing" : sha.slice(0, 7);
}

function tipIn(facts: RepoFacts, branch: string): Sha | null {
  return facts.branches.find((candidate) => candidate.name === branch)?.tip ?? null;
}

function moved(name: string, was: Sha | null, now: Sha | null): string[] {
  if (was === now) return [];
  return [now === null ? `${name} was deleted` : `${name} moved: was ${short(was)}, now ${short(now)}`];
}

function describeMoves(moves: RestackMove[]): string {
  return moves.map((move) => `${move.branch} onto ${move.onto}`).join(", ") || "none";
}

async function movesNow(read: RestackRead, fresh: RepoFacts): Promise<string[]> {
  const feature = findFeature(await readStackFacts(fresh.root, fresh), read.feature.name);
  if (feature?.kind !== "stack") return [`${read.feature.name} is no longer a stack`];
  const was = describeMoves(read.levels.map((level) => level.move));
  const now = describeMoves(orderRestack(feature, fresh.trunk.name).moves);
  return was === now ? [] : [`The levels that move changed: was ${was}; now ${now}`];
}

async function recheckRun(ctx: ActionContext, read: RestackRead, fresh: RepoFacts, pins: Map<string, string>): Promise<string[]> {
  const lines: string[] = [];
  if (fresh.trunk.ref !== read.trunk.ref) lines.push(`The trunk is now ${fresh.trunk.ref}, not ${read.trunk.ref}`);
  lines.push(...moved(read.trunk.name, read.trunk.sha, await resolveCommit(fresh.root, read.trunk.ref)));
  for (const [branch, sha] of read.tips) lines.push(...moved(branch, sha, tipIn(fresh, branch)));
  for (const level of read.levels) {
    const { branch } = level.move;
    const edge = fresh.edges.find((candidate) => candidate.branch === branch);
    if (edge?.parent !== level.edge?.parent) {
      lines.push(`${branch}'s parent changed: was ${level.edge?.parent ?? "none"}, now ${edge?.parent ?? "none"}`);
    } else if (edge?.forkPoint !== level.edge?.forkPoint) {
      lines.push(`${branch}'s recorded fork point changed`);
    }
    const pinRef = pins.get(branch);
    const pinned = pinRef === undefined ? null : await resolveCommit(fresh.root, pinRef);
    if (pinned !== level.tip) lines.push(`${branch} is not pinned at ${short(level.tip)}`);
  }
  for (const branch of rewrittenLevels(ctx.store, fresh.commonDir, [...read.tips.keys()])) {
    lines.push(`${branch} has a rewrite to restore or keep first`);
  }
  if (lines.length === 0) lines.push(...(await movesNow(read, fresh)));
  return lines;
}

async function recheckLevel(read: RestackRead, { level, fresh, movedTips }: RecheckInput): Promise<string[]> {
  const { branch, onto, ontoTrunk } = level.move;
  const lines = moved(branch, level.tip, tipIn(fresh, branch));
  const holder = holderIn(fresh, branch);
  if (holder?.path !== level.holder?.path) {
    lines.push(
      holder === undefined
        ? `${displayPath(fresh.root, level.holder?.path ?? "")} no longer has ${branch} checked out`
        : `${branch} is now checked out in ${displayPath(fresh.root, holder.path)}`,
    );
  }
  const ontoMoves = read.levels.some((candidate) => candidate.move.branch === onto);
  const busy = [
    { name: branch, worktree: busyIn(fresh, branch) },
    { name: onto, worktree: ontoMoves ? undefined : busyIn(fresh, onto) },
  ];
  for (const { name, worktree } of busy) {
    if (worktree?.operation) {
      lines.push(`${name} has a ${worktree.operation} in progress in ${displayPath(fresh.root, worktree.path)}`);
    }
  }
  if (ontoTrunk) {
    lines.push(...moved(read.trunk.name, read.trunk.sha, await resolveCommit(fresh.root, read.trunk.ref)));
  } else {
    lines.push(...moved(onto, movedTips.get(onto) ?? read.tips.get(onto) ?? null, tipIn(fresh, onto)));
  }
  return lines;
}

/**
 * What changed since a restack plan was read that matters before `level` moves: the level is at its tip, still checked
 * out and idle, and its new base is idle and at the tip expected. On the first level it also re-checks what the plan's
 * expectations do not cover: the trunk, each moving level's parent and fork point, the pins, open rewrites and, on fresh
 * stack facts, which levels move. Resolves to one line per difference.
 */
export async function recheckBeforeMove(ctx: ActionContext, read: RestackRead, input: RecheckInput): Promise<string[]> {
  const lines = [...(input.first ? await recheckRun(ctx, read, input.fresh, input.pins) : []), ...(await recheckLevel(read, input))];
  return [...new Set(lines)];
}
