import { lstat, realpath, stat } from "node:fs/promises";
import { dirname, join, matchesGlob, resolve, sep } from "node:path";
import { readRepoFacts } from "../facts/read-repo-facts.js";
import { removalVerdict } from "../facts/removal-verdict.js";
import { parseWorktreeList, type RawWorktree } from "../git/parse-worktree-list.js";
import { runGit } from "../git/run-git.js";
import type { GuardCheck } from "./guard-check.types.js";
import type { GuardBlock } from "./guard-decision.types.js";
import { readWorktreeHead } from "./read-worktree-head.js";
import { removalBlockMessage, type UnsafeWorktree } from "./removal-block-message.js";
import type { ShellWord } from "./shell-line.types.js";

type Target = { shown: string; probe: string; holds: (path: string) => boolean };
type Inside = { raw: RawWorktree; real: string };

const WILDCARD = /[*?[{]/;

async function realOrNull(path: string): Promise<string | null> {
  return realpath(path).catch(() => null);
}

async function targetOf(cwd: string, word: ShellWord): Promise<Target | null> {
  const wanted = resolve(cwd, word.text);
  const parts = wanted.split(sep);
  const wild = word.glob ? parts.findIndex((part) => WILDCARD.test(part)) : -1;
  if (wild === -1) {
    const link = (await lstat(wanted).catch(() => null))?.isSymbolicLink() === true;
    if (link && !word.text.endsWith("/")) return null;
    const real = await realOrNull(wanted);
    if (real === null || !(await stat(real)).isDirectory()) return null;
    return { shown: real, probe: real, holds: (path) => path === real || path.startsWith(real + sep) };
  }
  const base = await realOrNull(parts.slice(0, wild).join(sep) || sep);
  if (base === null) return null;
  const pattern = join(base, ...parts.slice(wild));
  const holds = (path: string): boolean => {
    for (let at = path; at.startsWith(base + sep); at = dirname(at)) if (matchesGlob(at, pattern)) return true;
    return false;
  };
  return { shown: wanted, probe: base, holds };
}

async function listWorktrees(cwd: string): Promise<RawWorktree[] | null> {
  const result = await runGit(["worktree", "list", "--porcelain", "-z"], { cwd, allowFailure: true }).catch(() => null);
  return result?.code === 0 ? parseWorktreeList(result.stdout) : null;
}

async function judgeRepo(probe: string, from: string, target: Target, inside: Inside[], main: RawWorktree): Promise<GuardBlock | null> {
  const view = { from, root: (await realOrNull(main.path)) ?? main.path };
  if (inside.some(({ raw }) => raw === main)) {
    const head = await readWorktreeHead(probe).catch(() => null);
    return {
      message: removalBlockMessage(view, target.shown, [], main.path),
      verb: "rm -r",
      subject: head === null ? null : { commonDir: head.commonDir, root: head.root, worktree: main.path, branch: main.branch },
    };
  }
  const facts = await readRepoFacts(probe);
  const unsafe: (UnsafeWorktree & { branch: string | null })[] = [];
  for (const { raw, real } of inside) {
    const worktree = facts.worktrees.find((candidate) => candidate.path === raw.path);
    if (worktree === undefined) continue;
    const verdict = await removalVerdict(facts, worktree);
    if (!verdict.ok) unsafe.push({ path: real, verdict, branch: worktree.branch });
  }
  const [first] = unsafe;
  if (first === undefined) return null;
  return {
    message: removalBlockMessage(view, target.shown, unsafe, null),
    verb: "rm -r",
    subject: { commonDir: facts.commonDir, root: facts.root, worktree: first.path, branch: first.branch },
  };
}

/**
 * Blocks a recursive `rm` of a path that is a linked worktree, or holds one, unless every worktree it would delete is
 * safe to remove; a path holding the main worktree is always blocked. A symlink named without a trailing slash is the
 * link itself, which `rm` removes alone. Paths that do not exist or hold no worktree
 * cost one `git worktree list` per repository they could belong to: the one around `cwd` and the one around the path.
 */
export async function judgeRecursiveRm(check: GuardCheck & { kind: "recursive-rm" }, from: string): Promise<GuardBlock | null> {
  for (const word of check.paths) {
    const target = await targetOf(check.cwd, word);
    if (target === null) continue;
    const seen = new Set<string>();
    for (const probe of new Set([check.cwd, target.probe])) {
      const listing = await listWorktrees(probe);
      const [main] = listing ?? [];
      if (listing === null || main === undefined || seen.has(main.path)) continue;
      seen.add(main.path);
      const inside: Inside[] = [];
      for (const raw of listing) {
        const real = await realOrNull(raw.path);
        if (real !== null && target.holds(real)) inside.push({ raw, real });
      }
      if (inside.length === 0) continue;
      const block = await judgeRepo(probe, from, target, inside, main);
      if (block !== null) return block;
    }
  }
  return null;
}
