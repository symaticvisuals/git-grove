import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { run } from "../../src/cli/main.js";
import { openStore } from "../../src/core/journal/open-store.js";
import type { JournalEntry } from "../../src/core/journal/store.types.js";
import { makeRepo, type TestRepo } from "../support/make-repo.js";

type Result = { code: number; out: string; err: string };

const savedHome = process.env["GIT_GROVE_HOME"];
let home: string;
let repo: TestRepo;
let fork: string;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "git-grove-home-"));
  process.env["GIT_GROVE_HOME"] = home;
});
afterAll(async () => {
  if (savedHome === undefined) delete process.env["GIT_GROVE_HOME"];
  else process.env["GIT_GROVE_HOME"] = savedHome;
  await rm(home, { recursive: true, force: true });
});
beforeEach(async () => {
  repo = await makeRepo();
  await repo.git("config", "stack.trunk", "main");
  await repo.commit(".gitignore", ".worktrees/\n.local/\n", "ignore");
  fork = await repo.commit("base.txt", "base\n", "base");
  await repo.branch("feat");
  await repo.switch("feat");
  await repo.commit("a.txt", "a\n", "add a");
  await repo.commit("b.txt", "b\n", "add b");
  await repo.commit("c.txt", "c\n", "add c");
});
afterEach(() => repo.cleanup());

async function grove(argv: string[], cwd: string = repo.path): Promise<Result> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { out: (s) => out.push(s), err: (s) => err.push(s), cwd });
  return { code, out: out.join(""), err: err.join("") };
}

async function squash(): Promise<void> {
  await repo.git("reset", "--soft", fork);
  await repo.git("commit", "-m", "squashed");
}

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

/** Adds a worktree on `name` with one commit of its own, fast-forwarded into main, and leaves main checked out. */
async function landedWorktree(name: string): Promise<string> {
  await repo.switch("main");
  const path = join(repo.path, ".worktrees", name);
  await repo.worktree(path, name);
  await write(join(path, `${name}.txt`), `${name}\n`);
  await repo.git("-C", path, "add", `${name}.txt`);
  await repo.git("-C", path, "commit", "-m", `add ${name}`);
  await repo.git("merge", "--ff-only", name);
  return path;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function field(value: unknown, key: string): unknown {
  if (!isRecord(value) || !(key in value)) throw new Error(`missing ${key}`);
  return value[key];
}

function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("expected an array");
  return value;
}

async function statusJson(): Promise<Record<"findings" | "journal", unknown[]> & { keys: string[] }> {
  const result = await grove(["status", "--json"]);
  expect(result).toMatchObject({ code: 0, err: "" });
  const doc: unknown = JSON.parse(result.out);
  return {
    keys: isRecord(doc) ? Object.keys(doc).sort() : [],
    findings: list(field(doc, "findings")),
    journal: list(field(doc, "journal")),
  };
}

function rulesOf(findings: unknown[]): unknown[] {
  return findings.map((finding) => field(finding, "rule"));
}

test("status --json after a squash is one JSON document with one history-rewritten finding", async () => {
  await grove(["status"]);
  await squash();

  const doc = await statusJson();
  expect(doc.keys).toEqual(["features", "findings", "journal", "repo", "trunk"]);
  const rewritten = doc.findings.filter((finding) => field(finding, "rule") === "history-rewritten");
  expect(rewritten).toHaveLength(1);
  expect(field(rewritten[0], "subject")).toEqual({ kind: "branch", id: "feat" });
  expect(doc.journal).toHaveLength(1);
});

test("status prints Needs you with the rewrite and how to undo it", async () => {
  await grove(["status"]);
  await squash();

  const result = await grove(["status"]);
  expect(result.code).toBe(0);
  expect(result.out).toContain("Needs you");
  expect(result.out).toMatch(/history rewritten/i);
  expect(result.out).toContain("git grove restore feat");
  expect(result.out).toMatch(/^feat\s+clean\s+no remote\s+0\s/m);
});

test("restore brings the commits back and the next status has no rewrite", async () => {
  await grove(["status"]);
  await squash();
  await grove(["status"]);

  const result = await grove(["restore", "feat"]);
  expect(result).toMatchObject({ code: 0, err: "" });
  expect(result.out).toMatch(
    /^restored feat at [0-9a-f]{7} from refs\/grove\/pins\/feat\/\S+ \(3 commits back\)\nprevious tip [0-9a-f]{7} pinned at refs\/grove\/pins\/feat\/\S+\n$/,
  );
  expect((await repo.git("rev-list", "--count", "main..feat")).trim()).toBe("3");

  const doc = await statusJson();
  expect(rulesOf(doc.findings)).not.toContain("history-rewritten");
  expect(doc.journal).toEqual([]);
});

test("a rewrite whose commits later reach the trunk no longer alerts", async () => {
  await grove(["status"]);
  await squash();
  await grove(["status"]);
  await repo.switch("main");
  await repo.git("merge", "--squash", "feat");
  await repo.git("commit", "-m", "land feat");

  const doc = await statusJson();
  expect(rulesOf(doc.findings)).not.toContain("history-rewritten");
  expect(doc.journal).toEqual([]);
});

test("a branch reset back onto the trunk keeps its rewrite alert", async () => {
  await grove(["status"]);
  await repo.git("reset", "--hard", fork);

  const doc = await statusJson();
  expect(rulesOf(doc.findings)).toContain("history-rewritten");
});

test("check remove refuses a merged worktree holding .local/seed.sql", async () => {
  await repo.switch("main");
  await repo.worktree(join(repo.path, ".worktrees", "old"), "old");
  await write(join(repo.path, ".worktrees", "old", ".local", "seed.sql"), "insert;\n");

  const result = await grove(["check", "remove", ".worktrees/old"]);
  expect(result).toMatchObject({ code: 3, err: "" });
  expect(result.out).toContain(".local/seed.sql");

  const json = await grove(["check", "remove", ".worktrees/old", "--json"]);
  expect(json.code).toBe(3);
  const verdict: unknown = JSON.parse(json.out);
  expect(verdict).toMatchObject({ ok: false, reasons: [{ code: "precious-ignored", paths: [".local/seed.sql"] }] });
});

test("status checks a landed worktree holding .local/seed.sql and suggests check remove", async () => {
  const path = await landedWorktree("old");
  await write(join(path, ".local", "seed.sql"), "insert;\n");

  const unsafe = (await statusJson()).findings.filter((finding) => field(finding, "rule") === "unsafe-merged-worktree");
  expect(unsafe).toHaveLength(1);
  expect(field(unsafe[0], "action")).toMatch(/^git grove check remove \/.+\/\.worktrees\/old$/);
});

test("status does not check a worktree whose branch has no commits of its own", async () => {
  await repo.switch("main");
  const path = join(repo.path, ".worktrees", "fresh");
  await repo.worktree(path, "fresh");
  await write(join(path, "draft.txt"), "wip\n");

  const doc = await statusJson();
  expect(rulesOf(doc.findings)).not.toContain("unsafe-merged-worktree");
  expect((await grove(["status"])).out).toMatch(/^fresh\s+1 change\s+no remote\s/m);
});

test("a branch deleted after its squash merge does not alert", async () => {
  await grove(["status"]);
  await repo.switch("main");
  await repo.git("merge", "--squash", "feat");
  await repo.git("commit", "-m", "land feat");
  await repo.git("branch", "-D", "feat");

  const doc = await statusJson();
  expect(rulesOf(doc.findings)).not.toContain("branch-deleted");
  expect(doc.journal).toEqual([]);
});

test("a deleted branch with commits found nowhere else alerts", async () => {
  await grove(["status"]);
  await repo.switch("main");
  await repo.git("branch", "-D", "feat");

  const doc = await statusJson();
  expect(rulesOf(doc.findings)).toContain("branch-deleted");
  expect(doc.journal).toHaveLength(1);
});

test("status lists a merged worktree's files only under its removal alert, with paths from the root", async () => {
  await repo.switch("main");
  await repo.commit(".gitignore", ".worktrees/\n.local/\n.env\n", "ignore env");
  await write(join(repo.path, ".env"), "KEY=1\n");
  const path = await landedWorktree("old");
  await write(join(path, ".local", "seed.sql"), "insert;\n");

  const { out } = await grove(["status"]);
  expect(out.match(/\.local\/seed\.sql/g)).toHaveLength(1);
  expect(out).toMatch(/^ +\.worktrees\/old\/\.local\/seed\.sql$/m);
  expect(out).toContain(".env exists in the main worktree but not in .worktrees/old\n");
  expect(out).toMatch(/^old\s+clean\s+merged\s+0\s/m);
});

test("check remove passes a clean merged worktree and refuses the main one", async () => {
  await repo.worktree(join(repo.path, ".worktrees", "tidy"), "tidy", "main");

  expect(await grove(["check", "remove", join(repo.path, ".worktrees", "tidy")])).toMatchObject({ code: 0, err: "" });
  expect(await grove(["check", "remove", "."])).toMatchObject({
    code: 3,
    out: "the main worktree is never removed\n",
  });
});

test("check remove on a folder that is not a worktree exits 1 with one line on stderr", async () => {
  const result = await grove(["check", "remove", "nowhere"]);
  expect(result.code).toBe(1);
  expect(result.out).toBe("");
  expect(result.err.trimEnd().split("\n")).toHaveLength(1);
});

test("pins list prints each pin ref with its short sha", async () => {
  await grove(["status"]);
  await squash();
  await grove(["status"]);
  const pinRef = (await repo.git("for-each-ref", "--format=%(refname)", "refs/grove/pins/feat")).trim();
  const pinSha = (await repo.git("rev-parse", pinRef)).trim();

  const result = await grove(["pins", "list"]);
  expect(result).toMatchObject({ code: 0, out: `${pinRef}  ${pinSha.slice(0, 7)}\n` });
  expect((await grove(["pins", "list", "feat"])).out).toContain(pinRef);
  expect((await grove(["pins", "list", "other"])).out).toBe("");
});

test("status outside a repository exits 1 with exactly one line on stderr", async () => {
  const outside = await mkdtemp(join(tmpdir(), "git-grove-outside-"));
  try {
    const result = await grove(["status"], outside);
    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toMatch(/^git-grove: [^\n]+\n$/);
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test("restore with no pin exits 1 with one line on stderr", async () => {
  const result = await grove(["restore", "feat"]);
  expect(result).toMatchObject({ code: 1, out: "", err: "git-grove: no pin found for feat\n" });
});

test("an unknown flag exits 1 with usage on stderr", async () => {
  const result = await grove(["status", "--nope"]);
  expect(result.code).toBe(1);
  expect(result.out).toBe("");
  expect(result.err).toContain("Usage: git grove");
});

test("a command with the wrong arguments exits 1 with usage on stderr", async () => {
  for (const argv of [["restore"], ["pins"], ["check", "remove"], ["check", "push", "x"], ["restore", "feat", "--json"]]) {
    const result = await grove(argv);
    expect(result.code, argv.join(" ")).toBe(1);
    expect(result.err, argv.join(" ")).toContain("Usage: git grove");
  }
});

test("a missing git binary exits 1 with one line", async () => {
  const savedPath = process.env["PATH"];
  process.env["PATH"] = join(home, "no-bin");
  try {
    expect(await grove(["status"])).toEqual({ code: 1, out: "", err: "git-grove: git not found on PATH\n" });
  } finally {
    if (savedPath === undefined) delete process.env["PATH"];
    else process.env["PATH"] = savedPath;
  }
});

/** Runs `work` with GIT_GROVE_HOME pointing at `path`, then points it back at the suite's home. */
async function withHome(path: string, work: () => Promise<void>): Promise<void> {
  process.env["GIT_GROVE_HOME"] = path;
  try {
    await work();
  } finally {
    process.env["GIT_GROVE_HOME"] = home;
  }
}

/** Runs `work` with `folder` unreadable, restoring its permissions afterwards. */
async function withLocked(folder: string, work: () => Promise<void>): Promise<void> {
  await write(join(folder, "secret.txt"), "x\n");
  await chmod(folder, 0o000);
  try {
    await work();
  } finally {
    await chmod(folder, 0o755);
  }
}

test("status survives an unreadable ignored folder in the main worktree", async () => {
  await withLocked(join(repo.path, ".local", "locked"), async () => {
    const result = await grove(["status"]);
    expect(result).toMatchObject({ code: 0, err: "" });
  });
});

test("check remove names an unreadable ignored folder and refuses", async () => {
  const path = await landedWorktree("old");
  await withLocked(join(path, ".local", "locked"), async () => {
    const result = await grove(["check", "remove", ".worktrees/old"]);
    expect(result.code).toBe(3);
    expect(result.out).toContain(".local/locked/");
  });
});

test("a linked worktree on the trunk is not checked for removal", async () => {
  const path = join(repo.path, ".worktrees", "trunk");
  await repo.git("worktree", "add", path, "main");
  await writeFile(join(path, "base.txt"), "edited\n");

  expect(rulesOf((await statusJson()).findings)).not.toContain("unsafe-merged-worktree");
});

test("a branch only fast-forwarded or rebased onto main is not checked for removal", async () => {
  const cases: [string, string[]][] = [
    ["caught-up", ["merge", "--ff-only", "main"]],
    ["rebased", ["rebase", "main"]],
  ];
  for (const [name, args] of cases) {
    const path = join(repo.path, ".worktrees", name);
    await repo.worktree(path, name, "main~1");
    await repo.git("-C", path, ...args);
    await write(join(path, "draft.txt"), "wip\n");
  }

  expect(rulesOf((await statusJson()).findings)).not.toContain("unsafe-merged-worktree");
});

test("a landed branch whose reflog was expired is still checked for removal", async () => {
  const path = await landedWorktree("old");
  await repo.git("reflog", "expire", "--expire=now", "--expire-unreachable=now", "refs/heads/old");
  await write(join(path, ".local", "seed.sql"), "insert;\n");

  expect(rulesOf((await statusJson()).findings)).toContain("unsafe-merged-worktree");
});

async function journalEntries(): Promise<JournalEntry[]> {
  const commonDir = (await repo.git("rev-parse", "--path-format=absolute", "--git-common-dir")).trim();
  const store = openStore();
  try {
    const repoId = store.findRepoId(commonDir);
    return repoId === null ? [] : store.entries(repoId);
  } finally {
    store.close();
  }
}

test("resetting a squash back to the original raises nothing and journals the undo acked", async () => {
  await grove(["status"]);
  const original = (await repo.git("rev-parse", "feat")).trim();
  await squash();
  const squashed = (await repo.git("rev-parse", "feat")).trim();
  await grove(["status"]);
  await repo.git("reset", "--hard", original);

  const doc = await statusJson();
  expect(rulesOf(doc.findings)).not.toContain("history-rewritten");
  expect(doc.journal).toEqual([]);
  const undo = (await journalEntries()).find((entry) => entry.oldTip === squashed && entry.newTip === original);
  expect(undo).toMatchObject({ acked: true });
});

test("resetting back after a commit on top of the squash alerts and pins that commit", async () => {
  await grove(["status"]);
  const original = (await repo.git("rev-parse", "feat")).trim();
  await squash();
  await grove(["status"]);
  const extra = await repo.commit("d.txt", "d\n", "add d");
  await grove(["status"]);
  await repo.git("reset", "--hard", original);

  const rewritten = (await statusJson()).findings.filter((finding) => field(finding, "rule") === "history-rewritten");
  expect(rewritten).toHaveLength(1);
  const pinRef = /kept at (\S+)/.exec(String(field(rewritten[0], "detail")))?.[1] ?? "";
  expect((await repo.git("rev-parse", pinRef)).trim()).toBe(extra);
  const entry = (await journalEntries()).find((candidate) => candidate.oldTip === extra);
  expect(entry).toMatchObject({ kind: "rewritten", newTip: original, acked: false });
  expect(entry?.lost).toContain(extra);
});

test("restore recreates a deleted branch at its pin", async () => {
  await grove(["status"]);
  const tip = (await repo.git("rev-parse", "feat")).trim();
  await repo.switch("main");
  await repo.git("branch", "-D", "feat");
  expect(rulesOf((await statusJson()).findings)).toContain("branch-deleted");

  const result = await grove(["restore", "feat"]);
  expect(result).toMatchObject({ code: 0, err: "" });
  expect(result.out).toMatch(new RegExp(`^restored feat at ${tip.slice(0, 7)} from refs/grove/pins/feat/\\S+ \\(3 commits back\\)\\n$`));
  expect((await repo.git("rev-parse", "feat")).trim()).toBe(tip);
  expect(rulesOf((await statusJson()).findings)).not.toContain("branch-deleted");
});

test("an unusable grove home or a corrupt grove.db exits 1 with one line", async () => {
  const file = join(home, "not-a-folder");
  await writeFile(file, "x\n");
  await withHome(file, async () => {
    const result = await grove(["status"]);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/^git-grove: [^\n]+\n$/);
  });

  const corrupt = await mkdtemp(join(tmpdir(), "git-grove-corrupt-"));
  try {
    await writeFile(join(corrupt, "grove.db"), "this is not a database, it is a long enough line of text\n".repeat(100));
    await withHome(corrupt, async () => {
      const result = await grove(["status"]);
      expect(result.code).toBe(1);
      expect(result.err).toMatch(/^git-grove: [^\n]+\n$/);
    });
  } finally {
    await rm(corrupt, { recursive: true, force: true });
  }
});

test("restore opens the store before it moves the branch", async () => {
  await grove(["status"]);
  await squash();
  await grove(["status"]);
  const squashed = (await repo.git("rev-parse", "feat")).trim();
  const file = join(home, "not-a-folder");
  await writeFile(file, "x\n");

  await withHome(file, async () => {
    const result = await grove(["restore", "feat"]);
    expect(result).toMatchObject({ code: 1, out: "" });
    expect(result.err).toMatch(/^git-grove: [^\n]+\n$/);
  });
  expect((await repo.git("rev-parse", "feat")).trim()).toBe(squashed);
});

test("status actions name paths from the folder status runs in", async () => {
  const old = await landedWorktree("old");
  await write(join(old, ".local", "seed.sql"), "insert;\n");
  const side = join(repo.path, ".worktrees", "side");
  await repo.worktree(side, "side", "main");

  const { out } = await grove(["status"], side);
  const target = /git grove check remove (\S+)/.exec(out)?.[1] ?? "";
  expect(target).toBe("../old");
  expect(resolve(await realpath(side), target)).toBe(await realpath(old));
  expect((await grove(["check", "remove", target], side)).code).toBe(3);
});

/** The actions of the history-rewritten findings, from status --json. */
async function rewrittenActions(): Promise<string[]> {
  return (await statusJson()).findings
    .filter((finding) => field(finding, "rule") === "history-rewritten")
    .map((finding) => String(field(finding, "action")));
}

test("the history-rewritten action names the alert's own pin", async () => {
  await grove(["status"]);
  const original = (await repo.git("rev-parse", "feat")).trim();
  await squash();

  const [action] = await rewrittenActions();
  const pinRef = /^git grove restore feat (refs\/grove\/pins\/feat\/\S+)$/.exec(action ?? "")?.[1] ?? "";
  expect((await repo.git("rev-parse", pinRef)).trim()).toBe(original);
});

test("restore after a squash and a later amend brings back the original tip and status is clean", async () => {
  await grove(["status"]);
  const original = (await repo.git("rev-parse", "feat")).trim();
  await squash();
  await grove(["status"]);
  await writeFile(join(repo.path, "d.txt"), "d\n");
  await repo.git("add", "d.txt");
  await repo.git("commit", "--amend", "--no-edit");
  await grove(["status"]);

  const result = await grove(["restore", "feat"]);
  expect(result).toMatchObject({ code: 0, err: "" });
  expect(result.out).toMatch(new RegExp(`^restored feat at ${original.slice(0, 7)} from refs/grove/pins/feat/\\S+ \\(3 commits back\\)\\n`));
  expect((await repo.git("rev-parse", "feat")).trim()).toBe(original);
  const doc = await statusJson();
  expect(rulesOf(doc.findings)).not.toContain("history-rewritten");
  expect(doc.journal).toEqual([]);
});

test("two rewrites then a restore of the first pin leaves the second alert unresolved", async () => {
  await grove(["status"]);
  await squash();
  await grove(["status"]);
  const extra = await repo.commit("d.txt", "d\n", "add d");
  await grove(["status"]);
  await repo.git("reset", "--hard", "HEAD~1");
  const actions = await rewrittenActions();
  expect(actions).toHaveLength(2);
  const firstPin = (await journalEntries()).find((entry) => entry.kind === "rewritten" && entry.oldTip !== extra)?.pinRef ?? "";
  expect(actions).toContain(`git grove restore feat ${firstPin}`);

  expect((await grove(["restore", "feat", firstPin])).code).toBe(0);

  const left = await rewrittenActions();
  expect(left).toHaveLength(1);
  const secondPin = left[0]?.split(" ").at(-1) ?? "";
  expect((await repo.git("rev-parse", secondPin)).trim()).toBe(extra);
});

test("a squash that comes back after a restore alerts again", async () => {
  await grove(["status"]);
  await squash();
  const squashed = (await repo.git("rev-parse", "feat")).trim();
  await grove(["status"]);
  await grove(["restore", "feat"]);
  expect(rulesOf((await statusJson()).findings)).not.toContain("history-rewritten");

  await repo.git("reset", "--hard", squashed);
  expect(rulesOf((await statusJson()).findings)).toContain("history-rewritten");
});

test("squash, reset back, squash again and reset back again stays clean", async () => {
  await grove(["status"]);
  const original = (await repo.git("rev-parse", "feat")).trim();
  await squash();
  const squashed = (await repo.git("rev-parse", "feat")).trim();
  await grove(["status"]);
  await repo.git("reset", "--hard", original);
  await grove(["status"]);
  await repo.git("reset", "--hard", squashed);
  expect(rulesOf((await statusJson()).findings)).toContain("history-rewritten");
  await repo.git("reset", "--hard", original);

  const doc = await statusJson();
  expect(rulesOf(doc.findings)).not.toContain("history-rewritten");
  expect(doc.journal).toEqual([]);
});

test("ack dismisses a deliberate squash", async () => {
  await grove(["status"]);
  await squash();
  const status = await grove(["status"]);
  expect(status.out).toContain("git grove ack feat");

  expect(await grove(["ack", "feat"])).toEqual({ code: 0, out: "acknowledged 1 alert on feat\n", err: "" });
  const doc = await statusJson();
  expect(rulesOf(doc.findings)).not.toContain("history-rewritten");
  expect(doc.journal).toEqual([]);
  expect(await grove(["ack", "feat"])).toEqual({ code: 0, out: "nothing to acknowledge on feat\n", err: "" });
});

test("ack of a branch with no alerts, or no such branch, has nothing to acknowledge", async () => {
  expect(await grove(["ack", "feat"])).toEqual({ code: 0, out: "nothing to acknowledge on feat\n", err: "" });
  expect(await grove(["ack", "nope"])).toEqual({ code: 0, out: "nothing to acknowledge on nope\n", err: "" });
  expect((await grove(["--help"])).out).toContain("ack <branch>");
});

test("restore refuses while the branch is mid-rebase in a worktree, and adds no pin", async () => {
  const path = join(repo.path, ".worktrees", "a");
  await repo.worktree(path, "a", "main");
  for (const name of ["a1", "a2"]) {
    await write(join(path, `${name}.txt`), `${name}\n`);
    await repo.git("-C", path, "add", `${name}.txt`);
    await repo.git("-C", path, "commit", "-m", name);
  }
  await write(join(path, "base.txt"), "from a\n");
  await repo.git("-C", path, "commit", "-am", "a edits base");
  await grove(["status"]);
  await repo.git("-C", path, "reset", "--soft", "main");
  await repo.git("-C", path, "commit", "-m", "squashed");
  await grove(["status"]);
  const squashed = (await repo.git("rev-parse", "a")).trim();
  const main = join(repo.path, ".worktrees", "main");
  await repo.git("worktree", "add", main, "main");
  await write(join(main, "base.txt"), "from main\n");
  await repo.git("-C", main, "commit", "-am", "main edits base");
  await expect(repo.git("-C", path, "rebase", "main")).rejects.toThrow();
  const pins = await repo.git("for-each-ref", "refs/grove/pins/a");

  const result = await grove(["restore", "a"]);
  expect(result.code).toBe(1);
  expect(result.err).toMatch(/^git-grove: a has a rebase in progress in \S+\.worktrees\/a; finish or abort it first\n$/);
  expect((await repo.git("rev-parse", "a")).trim()).toBe(squashed);
  expect(await repo.git("for-each-ref", "refs/grove/pins/a")).toBe(pins);
});

test("restore of a branch whose worktree folder is gone moves the branch", async () => {
  const path = join(repo.path, ".worktrees", "side");
  await repo.worktree(path, "side", "main");
  for (const name of ["s1", "s2", "s3"]) {
    await write(join(path, `${name}.txt`), `${name}\n`);
    await repo.git("-C", path, "add", `${name}.txt`);
    await repo.git("-C", path, "commit", "-m", name);
  }
  await grove(["status"]);
  const original = (await repo.git("rev-parse", "side")).trim();
  await repo.git("-C", path, "reset", "--soft", "main");
  await repo.git("-C", path, "commit", "-m", "squashed");
  await grove(["status"]);
  await rm(path, { recursive: true, force: true });

  const result = await grove(["restore", "side"]);
  expect(result).toMatchObject({ code: 0, err: "" });
  expect((await repo.git("rev-parse", "side")).trim()).toBe(original);
});

/** Commits `coupons` off main, editing base.txt's only line and adding extra.txt, and leaves main checked out. */
async function couponsBranch(): Promise<void> {
  await repo.switch("main");
  await repo.branch("coupons");
  await repo.switch("coupons");
  await repo.commit("base.txt", "base, coupons\n", "coupons one");
  await repo.commit("extra.txt", "extra\n", "coupons two");
  await repo.switch("main");
}

async function squashMergeCoupons(): Promise<void> {
  await repo.git("merge", "--squash", "coupons");
  await repo.git("commit", "-m", "coupons (#2)");
}

test("a branch squash-merged and deleted stays resolved after the trunk edits the same line", async () => {
  await couponsBranch();
  await grove(["status"]);
  await squashMergeCoupons();
  await repo.git("branch", "-D", "coupons");
  expect(rulesOf((await statusJson()).findings)).not.toContain("branch-deleted");
  expect((await journalEntries()).find((entry) => entry.branch === "coupons")).toMatchObject({ kind: "deleted", acked: true });

  await repo.commit("base.txt", "base, coupons v2\n", "coupons follow-up");
  const doc = await statusJson();
  expect(rulesOf(doc.findings)).not.toContain("branch-deleted");
  expect(doc.journal).toEqual([]);
});

test("a deletion first seen after the trunk moved on past its squash merge resolves", async () => {
  await couponsBranch();
  await grove(["status"]);
  await squashMergeCoupons();
  await repo.commit("base.txt", "base, coupons v2\n", "coupons follow-up");
  await repo.git("branch", "-D", "coupons");

  const doc = await statusJson();
  expect(rulesOf(doc.findings)).not.toContain("branch-deleted");
  expect(doc.journal).toEqual([]);
});

test("a squash merge the trunk reverted leaves the worktree unsafe to remove, and deleting the branch alerts", async () => {
  await couponsBranch();
  const path = join(repo.path, ".worktrees", "coupons");
  await repo.git("worktree", "add", path, "coupons");
  await grove(["status"]);
  await squashMergeCoupons();
  await repo.git("revert", "--no-edit", "HEAD");

  expect(await grove(["check", "remove", ".worktrees/coupons"])).toMatchObject({
    code: 3,
    out: "2 commits not pushed or merged\n",
  });
  await repo.git("worktree", "remove", path);
  await repo.git("branch", "-D", "coupons");
  expect(rulesOf((await statusJson()).findings)).toContain("branch-deleted");
  expect((await journalEntries()).find((entry) => entry.branch === "coupons")).toMatchObject({ kind: "deleted", acked: false });
});

test("a parent merged with a merge commit gives the child a Parent merged finding", async () => {
  await repo.switch("main");
  await repo.git("config", "branch.feat.stackparent", "main");
  await repo.branch("feat-ui", "feat");
  await repo.git("config", "branch.feat-ui.stackparent", "feat");
  await repo.commit("other.txt", "other\n", "unrelated trunk work");
  await repo.git("merge", "--no-ff", "-m", "Merge feat (#1)", "feat");

  const merged = (await statusJson()).findings.filter((finding) => field(finding, "rule") === "parent-merged");
  expect(merged).toHaveLength(1);
  expect(merged[0]).toMatchObject({ title: "Parent merged", subject: { kind: "level", id: "feat/feat-ui" } });
});

/** Adds a detached worktree at .worktrees/<name> with `commits` commits of its own, deletes its folder, returns its HEAD. */
async function goneSandbox(name: string, commits: number): Promise<string> {
  const path = join(repo.path, ".worktrees", name);
  await repo.git("worktree", "add", "--detach", path, "main");
  for (let i = 0; i < commits; i++) {
    await write(join(path, `exp${i}.txt`), "experiment\n");
    await repo.git("-C", path, "add", `exp${i}.txt`);
    await repo.git("-C", path, "commit", "-m", `experiment ${i}`);
  }
  const head = (await repo.git("-C", path, "rev-parse", "HEAD")).trim();
  await rm(path, { recursive: true, force: true });
  return head;
}

test("a detached worktree whose folder is gone, with commits only on its HEAD, says how to rescue them", async () => {
  const head = await goneSandbox("sandbox", 1);
  const prunable = (await statusJson()).findings.filter((finding) => field(finding, "rule") === "prunable");
  expect(prunable).toEqual([expect.objectContaining({ severity: "loses-work", action: `git branch rescue/sandbox ${head}` })]);
});

test("a detached worktree whose folder is gone and whose HEAD object is missing says how to rescue it", async () => {
  await goneSandbox("sandbox", 1);
  const missing = "1234567890abcdef1234567890abcdef12345678";
  await writeFile(join(repo.path, ".git", "worktrees", "sandbox", "HEAD"), `${missing}\n`);

  const prunable = (await statusJson()).findings.filter((finding) => field(finding, "rule") === "prunable");
  expect(prunable).toEqual([
    expect.objectContaining({
      severity: "loses-work",
      detail: expect.stringContaining("could not check commits on its detached HEAD"),
      action: `git branch rescue/sandbox ${missing}`,
    }),
  ]);
});

test("a detached worktree whose folder is gone with nothing of its own can be pruned", async () => {
  await goneSandbox("empty", 0);
  const prunable = (await statusJson()).findings.filter((finding) => field(finding, "rule") === "prunable");
  expect(prunable).toEqual([expect.objectContaining({ severity: "needs-action", action: "git worktree prune" })]);
});

test("check remove of an orphan-history worktree with a local commit exits 3 with a reason", async () => {
  const path = join(repo.path, ".worktrees", "pages");
  await repo.git("worktree", "add", "--orphan", "-b", "gh-pages", path);
  await write(join(path, "index.html"), "docs\n");
  await repo.git("-C", path, "add", "index.html");
  await repo.git("-C", path, "commit", "-m", "publish docs");

  const result = await grove(["check", "remove", ".worktrees/pages"]);
  expect(result).toMatchObject({ code: 3, err: "", out: "1 commit not pushed or merged\n" });
});

test("a hotfix cherry-picked to main, then the branch rebased onto main, raises no alert", async () => {
  await repo.commit("fix.txt", "fix\n", "hotfix for prod");
  await repo.commit("d.txt", "d\n", "add d");
  await grove(["status"]);
  await repo.switch("main");
  await repo.git("cherry-pick", "feat~1");
  await repo.switch("feat");
  await repo.git("rebase", "main");

  const doc = await statusJson();
  expect(rulesOf(doc.findings)).not.toContain("history-rewritten");
  expect((await journalEntries()).find((entry) => entry.branch === "feat")).toMatchObject({ kind: "rebased", lost: [] });
});

test("a bare-repository worktree layout says it is not supported, on every command", async () => {
  const layout = await mkdtemp(join(tmpdir(), "git-grove-bare-"));
  try {
    await repo.git("clone", "--quiet", "--bare", repo.path, join(layout, ".bare"));
    await writeFile(join(layout, ".git"), "gitdir: ./.bare\n");
    await repo.git("-C", layout, "worktree", "add", "--quiet", join(layout, "main"), "main");
    await repo.git("-C", layout, "worktree", "add", "--quiet", "-b", "feat-a", join(layout, "feat-a"), "main");
    const unsupported = { code: 1, out: "", err: "git-grove: bare repositories are not supported yet\n" };
    for (const [argv, cwd] of [
      [["status"], join(layout, "feat-a")],
      [["status"], layout],
      [["check", "remove", "../feat-a"], join(layout, "main")],
      [["restore", "feat-a"], join(layout, "feat-a")],
      [["pins", "list"], join(layout, "main")],
      [["ack", "feat-a"], join(layout, "main")],
    ] satisfies [string[], string][]) {
      expect(await grove(argv, cwd), argv.join(" ")).toEqual(unsupported);
    }
  } finally {
    await rm(layout, { recursive: true, force: true });
  }
});

test("a merged worktree's files are shown from the folder status runs in", async () => {
  const old = await landedWorktree("old");
  await write(join(old, ".local", "seed.sql"), "insert;\n");

  expect((await grove(["status"], old)).out).toMatch(/^ +\.local\/seed\.sql$/m);
  expect((await grove(["status"], join(repo.path, ".worktrees"))).out).toMatch(/^ +old\/\.local\/seed\.sql$/m);
});
