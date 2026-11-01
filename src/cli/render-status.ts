import { basename, relative } from "node:path";
import type { RepoFacts, WorktreeFacts } from "../core/facts/facts.types.js";
import { needsYou } from "../core/rules/needs-you.js";
import type { Finding, Severity } from "../core/rules/rule.types.js";
import { unsafeMergedWorktree } from "../core/rules/v1/unsafe-merged-worktree.js";
import type { Verdict } from "../core/rules/verdict.types.js";
import type { Feature, Level } from "../core/stacks/stacks.types.js";

export type StatusView = {
  facts: RepoFacts;
  features: Feature[];
  findings: Finding[];
  /** Removal verdicts of the merged worktrees, by path. */
  removals: Map<string, Verdict>;
  /** The folder status runs in; printed paths are relative to it. */
  cwd: string;
  now: number;
  elapsedMs: number;
};

type Row = { worktree: WorktreeFacts | null; level: Level | null };

const MARKS: Record<Severity, string> = { "loses-work": "✖", "needs-action": "▲", "waiting-on-review": "●", idle: "·" };
const MAX_PATHS = 3;
const PATH_START = `(?<![^\\s,(:'"])`;
const PATH_END = `(?![^/\\s,;:)'"])`;

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function age(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} d`;
}

function subjectLabel(finding: Finding, view: StatusView): string {
  const { kind, id } = finding.subject;
  if (kind === "branch") return id;
  if (kind === "level") {
    for (const feature of view.features) {
      const level = feature.levels.find((candidate) => `${feature.name}/${candidate.branch}` === id);
      if (level) return level.branch;
    }
    return id;
  }
  const worktree = view.facts.worktrees.find((candidate) => candidate.path === id);
  return worktree?.branch ?? fromCwd(id, view.cwd);
}

function fromCwd(path: string, cwd: string): string {
  return relative(cwd, path) || ".";
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Rewrites each worktree path standing alone in `text` relative to the caller's folder, longest path first. */
function shortenPaths(text: string, view: StatusView): string {
  const paths = view.facts.worktrees.map((worktree) => worktree.path).sort((a, b) => b.length - a.length);
  return paths.reduce((out, path) => {
    const standalone = new RegExp(`${PATH_START}${escapeRegExp(path)}${PATH_END}`, "g");
    return out.replace(standalone, () => fromCwd(path, view.cwd));
  }, text);
}

function removalPaths(finding: Finding, view: StatusView): string[] {
  if (finding.rule !== unsafeMergedWorktree.id) return [];
  const paths = view.removals.get(finding.subject.id)?.reasons.flatMap((reason) => reason.paths) ?? [];
  if (paths.length === 0) return [];
  const shown = paths.slice(0, MAX_PATHS).join(", ");
  return [paths.length > MAX_PATHS ? `${shown} and ${paths.length - MAX_PATHS} more` : shown];
}

function needsYouLines(view: StatusView): string[] {
  const urgent = needsYou(view.findings);
  if (urgent.length === 0) return ["Nothing needs you"];
  const labelled = urgent.map((finding) => ({ finding, label: subjectLabel(finding, view) }));
  const width = Math.max(...labelled.map(({ label }) => label.length));
  const indent = " ".repeat(width + 5);
  const lines = ["Needs you"];
  for (const { finding, label } of labelled) {
    lines.push(` ${MARKS[finding.severity]} ${label.padEnd(width)}  ${finding.title}`);
    const extras = [finding.detail, ...removalPaths(finding, view), ...(finding.action === null ? [] : [finding.action])];
    lines.push(...extras.map((extra) => `${indent}${shortenPaths(extra, view)}`));
  }
  return lines;
}

function rowsInOrder(view: StatusView): Row[] {
  const rows: Row[] = [];
  const shown = new Set<string>();
  const add = (worktree: WorktreeFacts | null, level: Level | null): void => {
    if (worktree !== null) {
      if (shown.has(worktree.path)) return;
      shown.add(worktree.path);
    }
    rows.push({ worktree, level });
  };
  const levels = view.features.flatMap((feature) => feature.levels);
  const main = view.facts.worktrees.find((worktree) => worktree.isMain);
  if (main && !levels.some((level) => level.worktree?.path === main.path)) add(main, null);
  for (const level of levels) add(level.worktree, level);
  for (const worktree of view.facts.worktrees) add(worktree, null);
  return rows;
}

function labelCell({ worktree, level }: Row, cwd: string): string {
  const name = level?.branch ?? worktree?.branch ?? `${fromCwd(worktree?.path ?? cwd, cwd)} (detached)`;
  const depth = level?.depth ?? 1;
  return depth > 1 ? `${"  ".repeat(depth - 1)}└ ${name}` : name;
}

function changesCell(worktree: WorktreeFacts | null): string {
  if (worktree === null) return "no worktree";
  if (worktree.prunable) return "folder gone";
  if (worktree.operation !== null) return `${worktree.operation} in progress`;
  if (worktree.changes === null) return "unknown";
  const { staged, unstaged, untracked } = worktree.changes;
  const total = staged + unstaged + untracked;
  return total === 0 ? "clean" : plural(total, "change");
}

function originCell({ worktree, level }: Row, view: StatusView): string {
  const name = level?.branch ?? worktree?.branch ?? null;
  if (name === null) return "-";
  if (worktree !== null && view.removals.has(worktree.path)) return "merged";
  const upstream = view.facts.branches.find((branch) => branch.name === name)?.upstream ?? null;
  if (upstream === null) return "no remote";
  if (upstream.gone) return "remote gone";
  const parts = [
    ...(upstream.ahead > 0 ? [`${upstream.ahead} unpushed`] : []),
    ...(upstream.behind > 0 ? [`${upstream.behind} behind`] : []),
  ];
  return parts.length > 0 ? parts.join(", ") : "in sync";
}

function behindCell(level: Level | null, trunk: string): string {
  if (level === null) return "-";
  if (level.parent !== trunk && level.parentCommitsSinceFork > 0) return `parent +${level.parentCommitsSinceFork}`;
  return String(level.behindTrunk);
}

function touchedCell(worktree: WorktreeFacts | null, view: StatusView): string {
  if (worktree === null || worktree.touchedAt === null) return "-";
  const idle = view.findings.some((finding) => finding.severity === "idle" && finding.subject.id === worktree.path);
  return `${age(view.now - worktree.touchedAt)}${idle ? ", idle" : ""}`;
}

function alignColumns(rows: string[][]): string[] {
  const columns = Math.max(...rows.map((row) => row.length));
  const widths = Array.from({ length: columns }, (_, column) => Math.max(...rows.map((row) => (row[column] ?? "").length)));
  return rows.map((row) => row.map((cell, column) => cell.padEnd((widths[column] ?? 0) + 2)).join("").trimEnd());
}

/**
 * Renders `git grove status` as plain text: a header, the "Needs you" block (needs-action or worse, worst first)
 * with each finding's detail and action, then one line per worktree, stack levels indented under their parent.
 * Worktree paths are shown relative to `cwd`, so a printed command works from where status ran.
 */
export function renderStatus(view: StatusView): string {
  const { facts } = view;
  const header = [
    `${basename(facts.root)}, trunk ${facts.trunk.name}, ${plural(facts.worktrees.length, "worktree")},`,
    `scanned in ${(view.elapsedMs / 1000).toFixed(1)} s`,
  ].join(" ");
  const table = [
    ["Worktree", "Changes", "Origin", `Behind ${facts.trunk.name}`, "Touched"],
    ...rowsInOrder(view).map((row) => [
      labelCell(row, view.cwd),
      changesCell(row.worktree),
      originCell(row, view),
      behindCell(row.level, facts.trunk.name),
      touchedCell(row.worktree, view),
    ]),
  ];
  return [header, "", ...needsYouLines(view), "", ...alignColumns(table)].join("\n") + "\n";
}
