import { basename } from "node:path";
import type { RepoFacts } from "../../facts/facts.types.js";
import { plural } from "../../rules/plural.js";
import type { Reason, ReasonCode } from "../../rules/verdict.types.js";
import { branchContext } from "../branch-context.js";
import { displayPath } from "../display-path.js";
import { listPaths } from "../list-paths.js";
import type { Check, Plan } from "../plan.types.js";
import { shellWord } from "../shell-word.js";
import { copyDetail } from "./copy-detail.js";
import { describeReason } from "./describe-reason.js";
import { formatSize } from "./format-size.js";
import type { Removal } from "./read-removal.js";
import { removalCommands } from "./removal-commands.js";
import { renamedCopyNote } from "./renamed-copy-note.js";

/** A remove plan's reading: the worktree, whether to rescue its precious files, and whether its branch has landed. */
export type RemoveRead = { removal: Removal; rescue: boolean; landed: boolean };

const WORK: readonly ReasonCode[] = ["uncommitted", "untracked", "stash", "unpushed"];

function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function mergeCheck(facts: RepoFacts, { removal, landed }: RemoveRead, reason: (code: ReasonCode) => Reason | undefined): Check {
  const trunk = facts.trunk.name;
  if (removal.worktree.branch === null) {
    const detached = reason("detached-only");
    return detached
      ? { ok: false, text: sentence(detached.detail), why: "Put them on a branch first." }
      : { ok: true, text: "No commits only this detached HEAD holds", why: null };
  }
  if (landed) return { ok: true, text: `Merged into ${trunk}`, why: null };
  const unpushed = reason("unpushed");
  return unpushed
    ? { ok: false, text: `Not merged into ${trunk}`, why: sentence(unpushed.detail) }
    : { ok: true, text: "Every commit is pushed or merged", why: `Not merged into ${trunk}; the branch is kept` };
}

function ignoredCheck(read: RemoveRead, reason: (code: ReasonCode) => Reason | undefined): Check {
  const { copies } = read.removal;
  if (reason("too-many-ignored")) return { ok: false, text: "Too many ignored files to check", why: "Look through the folder by hand." };
  if (copies.length === 0) return { ok: true, text: "No ignored files exist only here", why: null };
  const listed = copies.map((copy) => (copy.size === null ? copy.from : `${copy.from}, ${formatSize(copy.size)}`));
  const shown = copies.length > 3 ? [...listed.slice(0, 3), `and ${copies.length - 3} more`] : listed;
  return {
    ok: read.rescue,
    text: `${plural(copies.length, "ignored file")} ${copies.length === 1 ? "exists" : "exist"} only here`,
    why: `${shown.join("; ")}, ${read.rescue ? "copied to main first" : "not in the main checkout"}`,
  };
}

function checksOf(facts: RepoFacts, read: RemoveRead): Check[] {
  const { verdict } = read.removal;
  if (verdict === null) return [];
  const reason = (code: ReasonCode): Reason | undefined => verdict.reasons.find((candidate) => candidate.code === code);
  const work = WORK.flatMap((code) => verdict.reasons.filter((candidate) => candidate.code === code));
  const nested = reason("nested-worktree");
  const repos = reason("nested-repo");
  const unreadable = reason("unreadable");
  return [
    mergeCheck(facts, read, reason),
    work.length === 0
      ? { ok: true, text: "No uncommitted, untracked, stashed or unpushed work", why: null }
      : { ok: false, text: "Work that exists only here", why: work.map((each) => describeReason(facts.root, each)).join("; ") },
    nested
      ? { ok: false, text: sentence(nested.detail), why: listPaths(nested.paths.map((path) => displayPath(facts.root, path))) }
      : { ok: true, text: "No worktree inside this folder", why: null },
    ...(repos ? [{ ok: false, text: sentence(repos.detail), why: `${listPaths(repos.paths)}; its history would go with the folder` }] : []),
    ignoredCheck(read, reason),
    ...(unreadable ? [{ ok: false, text: sentence(unreadable.detail), why: null }] : []),
  ];
}

function effectsOf(read: RemoveRead): string[] {
  const { removal } = read;
  const copies = read.rescue ? removal.copies : [];
  const effects = copies.map((copy) =>
    copy.to === copy.from
      ? `Copy ${copy.from} into the main checkout. Main has no file there.`
      : `Copy ${copy.from} into the main checkout as ${copy.to}. Main's own ${copy.from} stays as it is.`,
  );
  if (copies.length > 0) effects.push("Check the copy matches byte for byte. If it doesn't, stop.");
  effects.push(`Remove the folder ${removal.shown}.${removal.worktree.branch === null ? "" : " The branch stays."}`);
  return effects;
}

function blockersOf(read: RemoveRead): string[] {
  const { removal } = read;
  if (read.rescue || removal.precious === null) return removal.blockers;
  const them = removal.copies.length === 1 ? "it" : "them";
  const rescue = `To copy ${them} to main first, run git grove rm --rescue ${shellWord(removal.shown)}`;
  return [`${removal.precious}. ${rescue}`, ...removal.blockers];
}

/** The plan for removing one worktree, rescuing its precious ignored files first when `rescue` is set. */
export function removePlan(facts: RepoFacts, read: RemoveRead): Plan {
  const { removal } = read;
  const { worktree, shown } = removal;
  const copies = read.rescue ? removal.copies : [];
  const files = copies.length === 1 ? "the file" : "the files";
  return {
    action: "remove",
    context: worktree.branch === null ? basename(facts.root) : branchContext(facts, worktree.branch),
    title: `Clean up ${removal.label}`,
    summary:
      copies.length > 0
        ? `Grove copies ${files} first, checks the copy, and only then removes the folder.`
        : "Grove re-checks the folder right before removing it.",
    confirm: copies.length > 0 ? "Copy, then remove" : "Remove",
    before: null,
    after: null,
    folders: null,
    choices: null,
    checks: checksOf(facts, read),
    effects: effectsOf(read),
    commands: removalCommands(removal, read.rescue),
    steps: [
      {
        title: "Check nothing moved since you looked",
        detail: worktree.head === null ? "" : `Still at ${worktree.head.slice(0, 7)}, nothing uncommitted`,
      },
      ...copies.map((copy) => ({ title: `Copy ${copy.from} to main`, detail: copyDetail(copy) })),
      ...(copies.length > 0 ? [{ title: "Check the copy matches", detail: "byte for byte" }] : []),
      { title: "Check it's safe to remove", detail: "nothing else only here" },
      { title: "Remove the worktree folder", detail: shown },
    ],
    blockers: blockersOf(read),
    note: [
      copies.length > 0
        ? "If the copy doesn't match, grove stops before removing anything."
        : "If anything new turns up in the folder, grove stops before removing it.",
      renamedCopyNote(copies),
    ]
      .filter((line) => line !== null)
      .join(" "),
    undoable: false,
    moves: [],
    expects: removal.expects,
    readAt: facts.readAt,
  };
}
