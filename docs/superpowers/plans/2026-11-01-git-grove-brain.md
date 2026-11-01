# git-grove brain and install: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The core of git-grove (facts, journal and rewrite classifier, pins and restore, stacks, removal verdict, rules) behind a `git grove` CLI that installs with `npx git-grove` or `npm i -g git-grove`.

**Architecture:** One npm package, TypeScript compiled with `tsc` to `dist/`, zero runtime dependencies. `src/core/git` is the only code that runs git; `src/core/facts` reads; `src/core/journal` records tip history in `node:sqlite` and classifies; `src/core/rules` is pure; `src/core/runner` is the only code that changes git and pins first. `src/cli` wires commands. The guard, server and dashboard are later slices.

**Tech Stack:** Node ≥ 24 (`node:sqlite`, `node:util` `parseArgs`, `node:child_process`), TypeScript strict, vitest against real temporary git repos, pnpm for development.

**Spec:** `docs/superpowers/specs/2026-11-01-git-grove-design.md` (sections 5, 6.0–6.5, 6.6b, 6.10).

## Global Constraints

- Package name `git-grove`; bin `git-grove`, so git runs it as `git grove`.
- `"engines": { "node": ">=24" }`; no runtime dependencies; no native modules.
- git ≥ 2.38 (for `git merge-tree --write-tree`); older git exits 1 with `git-grove needs git 2.38 or newer (found <x.y>)`.
- Every read-only git call uses `git --no-optional-locks`.
- Pins live at `refs/grove/pins/<branch>/<UTC yyyymmddTHHMMSSZ>`, with `-2`, `-3`… if taken.
- Data in `~/.git-grove/grove.db`; `GIT_GROVE_HOME` overrides the folder.
- TypeScript strict, no `any`. Comments only where logic needs them. kebab-case files, one exported abstraction per file, custom errors in `*.error.ts`.
- Tests isolate git from the user's config: `GIT_CONFIG_GLOBAL` points at an empty file and `GIT_CONFIG_NOSYSTEM=1`, set in `test/setup.ts`.
- All fixture names, branches and messages are invented.
- Commits carry no AI attribution lines.

## Review Focus

1. Run outside a git repo, or in a repo with no commits: one clear line on stderr, exit 1, no stack trace. (Task 3)
2. A merge commit inside a branch's own range has no patch ID; it must be matched by metadata, not counted as lost. (Task 4)
3. A huge ignored folder that is not in the default build/dependency list: the precious-file scan stops at 2,000 files and reports "too many ignored files to compare" as not safe, instead of hanging. (Task 8)
4. Two grove processes observing the same repo at once (dashboard plus CLI, later the guard): each change is journaled once. (Task 6)
5. On Node 24, `node:sqlite` emits an ExperimentalWarning; it must not reach stdout or break `--json`. (Task 1)

---

### Task 1: Package skeleton and install path

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `test/setup.ts`, `src/cli/main.ts`, `src/cli/quiet-sqlite-warning.ts`, `src/core/git/require-git-version.ts`, `src/core/git/git-version.error.ts`, `scripts/smoke-install.sh`, `test/cli/version.test.ts`, `test/core/git/require-git-version.test.ts`

**Interfaces:**
- Produces: `parseGitVersion(output: string): [number, number, number]`, `requireGitVersion(min: [number, number]): Promise<void>` (throws `GitVersionError`), `run(argv: string[], io: { out: (s: string) => void; err: (s: string) => void; cwd: string }): Promise<number>` in `src/cli/main.ts` (the bin calls it and sets `process.exitCode`).

- [ ] **Step 1:** `git init -b main` in `~/Developer/Personal/git-grove`; `package.json` with `"name": "git-grove"`, `"type": "module"`, `"bin": { "git-grove": "dist/cli/bin.js" }`, `"files": ["dist"]`, `"engines": { "node": ">=24" }`, scripts `build` (`tsc -p tsconfig.json`), `test` (`vitest run`), `prepublishOnly` (`pnpm build && pnpm test`); dev deps `typescript`, `vitest`, `@types/node` via `pnpm add -D`. `.gitignore`: `node_modules/`, `dist/`, `*.tgz`, `docs/figures/**/shots/`.
- [ ] **Step 2: Failing tests**

```ts
test("parseGitVersion reads Apple and plain git", () => {
  expect(parseGitVersion("git version 2.55.0")).toEqual([2, 55, 0]);
  expect(parseGitVersion("git version 2.39.3 (Apple Git-146)")).toEqual([2, 39, 3]);
});
test("--version prints the package version", async () => {
  const out: string[] = [];
  expect(await run(["--version"], { out: (s) => out.push(s), err: () => {}, cwd: process.cwd() })).toBe(0);
  expect(out.join("")).toMatch(/^git-grove \d+\.\d+\.\d+\n$/);
});
test("unknown command exits 1 with usage on stderr", async () => {
  const err: string[] = [];
  expect(await run(["nope"], { out: () => {}, err: (s) => err.push(s), cwd: process.cwd() })).toBe(1);
  expect(err.join("")).toContain("Usage: git grove");
});
```
- [ ] **Step 3:** Run `pnpm test`; expect failures (modules missing).
- [ ] **Step 4:** Implement. `src/cli/bin.ts` starts with `#!/usr/bin/env node`, imports `./quiet-sqlite-warning.js` first (wraps `process.emitWarning` and drops warnings whose text contains `SQLite`), then calls `run(process.argv.slice(2), …)`. `run` uses `parseArgs` with `allowPositionals`; commands are added in Task 10. Version read from `package.json` via `createRequire`.
- [ ] **Step 5:** `scripts/smoke-install.sh`: `pnpm build`, `npm pack`, install the tarball into a temp `--prefix`, put its `bin` first on `PATH`, then in a fresh temp repo run `git grove --version` and expect `git-grove 0.1.0`. Run it; expect that line.
- [ ] **Step 6:** `pnpm test` passes; commit `feat: package skeleton, git version check, installable bin`.

### Task 2: Git adapter and test repos

**Files:**
- Create: `src/core/git/run-git.ts`, `src/core/git/git.error.ts`, `src/core/git/parse-worktree-list.ts`, `test/support/make-repo.ts`, `test/core/git/run-git.test.ts`, `test/core/git/parse-worktree-list.test.ts`

**Interfaces:**
- Produces: `runGit(args: readonly string[], options: { cwd: string; input?: string; write?: boolean; allowFailure?: boolean }): Promise<{ stdout: string; stderr: string; code: number }>` (prepends `--no-optional-locks` unless `write`; throws `GitError { args, code, stderr }` on non-zero unless `allowFailure`); `parseWorktreeList(porcelain: string): RawWorktree[]` with `RawWorktree = { path: string; head: string | null; branch: string | null; bare: boolean; detached: boolean; locked: boolean; prunable: boolean }`.
- Test helper `makeRepo(): Promise<TestRepo>` with `commit(file, text, message, date?)`, `branch(name, from?)`, `switch(name)`, `worktree(path, branch, from?)`, `git(...args)`, `path`, `cleanup()`. Dates default to a fixed clock advancing one minute per commit.

- [ ] **Step 1: Failing tests:** `parseWorktreeList` on a literal porcelain sample with a main, a detached, a locked and a prunable entry returns the four flags and `branch` without `refs/heads/`; `runGit(["rev-parse","--nope"])` rejects with `GitError` whose `stderr` is non-empty; `allowFailure: true` resolves with `code !== 0`.
- [ ] **Step 2:** Run; expect failures.
- [ ] **Step 3:** Implement with `execFile("git", …, { maxBuffer: 64 MiB })`.
- [ ] **Step 4:** Tests pass; commit `feat: git adapter and porcelain parser`.

### Task 3: Repo facts

**Files:**
- Create: `src/core/facts/facts.types.ts`, `src/core/facts/read-repo-facts.ts`, `src/core/facts/resolve-trunk.ts`, `src/core/facts/not-a-repo.error.ts`, `test/core/facts/read-repo-facts.test.ts`

**Interfaces:**
- Consumes: `runGit`, `parseWorktreeList`.
- Produces, in `facts.types.ts`:

```ts
type Sha = string;
type Operation = "rebase" | "merge" | "cherry-pick" | "bisect";
type WorktreeFacts = { path: string; gitDir: string; head: Sha | null; branch: string | null; isMain: boolean; locked: boolean; prunable: boolean; operation: Operation | null; changes: { staged: number; unstaged: number; untracked: number } | null; touchedAt: number | null };
type BranchFacts = { name: string; tip: Sha; upstream: { ref: string; ahead: number; behind: number } | null };
type StackEdge = { branch: string; parent: string; forkPoint: Sha | null; feature: string | null };
type RepoFacts = { root: string; commonDir: string; trunk: { name: string; ref: string; sha: Sha }; lastFetchAt: number | null; worktrees: WorktreeFacts[]; branches: BranchFacts[]; edges: StackEdge[]; stashes: { ref: string; branch: string | null }[]; pins: { ref: string; sha: Sha }[]; readAt: number };
```
- `readRepoFacts(cwd: string): Promise<RepoFacts>` (throws `NotARepoError` with a one-line message outside a repo or with no commits); `resolveTrunk(cwd): Promise<RepoFacts["trunk"]>`: `stack.trunk`, else `origin/HEAD`'s branch, else `main`; `ref` is `refs/remotes/origin/<name>` when it exists, else `refs/heads/<name>`.
- `changes` comes from `status --porcelain=v2` per worktree, 8 at a time; `operation` from `rebase-merge`, `rebase-apply`, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `BISECT_LOG` in the worktree's git dir; `touchedAt` is the newer of the worktree's `index` and `HEAD` mtimes; `lastFetchAt` from `FETCH_HEAD` mtime; edges from `git config --get-regexp '^branch\..*\.(stackparent|stackforkpoint|grovefeature)$'`; stashes parsed from `WIP on <b>:` / `On <b>:`.

- [ ] **Step 1: Failing tests** on a repo with main, a worktree on `feat/a`, `branch.feat/b.stackparent feat/a`, a stash on `feat/a`, and a worktree stopped mid-rebase:
  - `facts.trunk` is `{ name: "main", ref: "refs/heads/main" }`;
  - the `feat/a` worktree has `changes.untracked === 1` after writing one new file;
  - `edges` contains `{ branch: "feat/b", parent: "feat/a" }`;
  - `stashes[0].branch === "feat/a"`;
  - the mid-rebase worktree has `operation === "rebase"`;
  - `readRepoFacts(tmpdir())` rejects with `NotARepoError`; so does a fresh `git init` with no commits.
- [ ] **Step 2:** Run; fail. **Step 3:** Implement. **Step 4:** Pass; commit `feat: read repo facts`.

### Task 4: Rewrite classifier

**Files:**
- Create: `src/core/journal/classify-tip-change.ts`, `src/core/journal/own-commits.ts`, `test/core/journal/classify-tip-change.test.ts`

**Interfaces:**
- Produces: `type ChangeKind = "advanced" | "rebased" | "amended" | "rewritten" | "deleted"`; `type TipChange = { branch: string; oldTip: Sha; newTip: Sha | null; kind: ChangeKind; lost: Sha[]; matchedByPatch: number; matchedByMeta: number }`; `classifyTipChange(input: { cwd: string; branch: string; oldTip: Sha; newTip: Sha; oldBase: Sha; newBase: Sha }): Promise<TipChange>`; `ownCommits(cwd, base, tip): Promise<{ sha: Sha; patchId: string | null; meta: string }[]>` (oldest first; `meta` is `authorEmail\0authorTime\0subject`; `patchId` from one `git log -p --format='commit %H' base..tip | git patch-id --stable`, null for merges and empty commits).

- [ ] **Step 1: Failing tests**, one per row; build each scenario in a temp repo with fixed dates (the 2026-11-01 spike in the spec is the reference):

| Test | oldBase / newBase | Expect |
|---|---|---|
| fast-forward | same | `advanced` |
| rebase onto moved main | fork / new main | `rebased`, `matchedByPatch === 3` |
| rebase that resolved a conflict | fork / conflict main | `rebased`, `matchedByPatch === 2`, `matchedByMeta === 1` |
| amend tip, message kept | fork / fork | `amended` |
| amend tip, message edited | fork / fork | `amended` |
| drop the middle commit | fork / fork | `rewritten`, `lost.length === 1` |
| squash 3 into 1 | fork / fork | `rewritten`, `lost.length === 3` |
| child restacked after parent squash-merged | old parent tip / main | `rebased`, `lost.length === 0` |
| merge commit in own range, rebased with `--rebase-merges` | fork / new main | `rebased` |

- [ ] **Step 2:** Run; fail. **Step 3:** Implement: ancestor check first; match each old own commit to an unused new own commit by `patchId`, then by `meta`; verdict per spec 6.3 (amended when `oldBase === newBase` and the only old commit not matched by patch is the tip; else rebased when nothing unmatched; else rewritten). **Step 4:** Pass; commit `feat: classify tip changes by own commits`.

### Task 5: Pins and restore

**Files:**
- Create: `src/core/runner/pin.ts`, `src/core/runner/list-pins.ts`, `src/core/runner/with-repo-lock.ts`, `src/core/runner/repo-locked.error.ts`, `src/core/runner/restore.ts`, `src/core/runner/refused.error.ts`, `test/core/runner/pin.test.ts`, `test/core/runner/restore.test.ts`

**Interfaces:**
- Produces: `pin(cwd, branch: string, sha: Sha, at: Date): Promise<string>` (returns the ref; suffixes `-2`… when taken); `listPins(cwd, branch?): Promise<{ ref: string; sha: Sha; branch: string; at: string }[]>` (newest first); `withRepoLock<T>(commonDir: string, fn: () => Promise<T>): Promise<T>` (exclusive create of `<commonDir>/grove.lock`, removed in `finally`; throws `RepoLockedError` if present); `restore(cwd, branch, pinRef?: string): Promise<{ from: Sha; to: Sha; pinnedCurrent: string }>` (default: newest pin of that branch; pins the current tip first; in a worktree with the branch checked out runs `git reset --keep <sha>` there, else `git update-ref refs/heads/<branch> <sha> <current>`; throws `RefusedError` when that worktree has uncommitted changes or an operation in progress).

- [ ] **Step 1: Failing tests:** `pin` on `feat/coupons-ui` returns `refs/grove/pins/feat/coupons-ui/20261101T231942Z` for that date, and `…-2` on a second call; `restore` after a squash brings back the 3 commits (`rev-list --count main..feat/x === 3`) and leaves a pin of the squashed tip; `restore` refuses with `RefusedError` when the worktree has an uncommitted file; a second `withRepoLock` while the first runs rejects with `RepoLockedError`.
- [ ] **Step 2–4:** fail, implement, pass; commit `feat: pins and restore with a repo lock`.

### Task 6: Store and journal

**Files:**
- Create: `src/core/journal/open-store.ts`, `src/core/journal/store.types.ts`, `src/core/journal/observe.ts`, `test/core/journal/observe.test.ts`

**Interfaces:**
- Consumes: `readRepoFacts`, `classifyTipChange`, `pin`.
- Produces: `openStore(path?: string): Store` (default `${GIT_GROVE_HOME ?? ~/.git-grove}/grove.db`; WAL, `busy_timeout = 2000`); `Store` with `repoId(commonDir, root): number`, `lastTips(repoId): Map<string, { sha: Sha; parentSha: Sha }>`, `saveTip(repoId, ref, sha, parentSha, at)`, `record(repoId, entry: JournalEntry): number | null` (`INSERT … ON CONFLICT DO NOTHING` on `UNIQUE(repo_id, ref, old_sha, new_sha)`, returns null when it already existed), `entries(repoId, { unresolved?: boolean }): JournalEntry[]`, `ack(repoId, entryId, at)`, `close()`; `JournalEntry = TipChange & { id?: number; pinRef: string | null; at: number; foundLater: boolean; acked: boolean }`; `observe(cwd, store, now = Date.now()): Promise<JournalEntry[]>` (new entries only).
- Rules: first sighting of a branch saves a baseline and records nothing; a moved tip is classified with `oldBase = merge-base(old, lastParentSha)` and `newBase = merge-base(new, currentParentTip)`, where the parent is the stack parent's tip, or trunk when it has none or its branch is gone; every non-fast-forward old tip is pinned before classifying; a vanished branch whose old tip is reachable from nothing (`rev-list <old> --not --branches --remotes --tags --glob=refs/grove`) is pinned and recorded as `deleted` with `lost` = those commits. "Unresolved" means kind `rewritten` or `deleted`, not acked, and not since merged into trunk.

- [ ] **Step 1: Failing tests** with `GIT_GROVE_HOME` in a temp dir: baseline then squash → one `rewritten` entry with `lost.length === 3` and a pin ref that exists; baseline then amend → `amended`, not unresolved; `Promise.all` of two `observe` calls on two `openStore` connections after one squash → exactly one row; branch deleted with 2 unique commits → `deleted` entry and pin; `ack` removes it from `entries({ unresolved: true })`.
- [ ] **Step 2–4:** fail, implement, pass; commit `feat: journal tip changes in node:sqlite`.

### Task 7: Stacks and merged detection

**Files:**
- Create: `src/core/stacks/group-features.ts`, `src/core/stacks/stacks.types.ts`, `src/core/stacks/read-stack-facts.ts`, `src/core/stacks/is-merged.ts`, `test/core/stacks/group-features.test.ts`, `test/core/stacks/read-stack-facts.test.ts`

**Interfaces:**
- Produces: `type Level = { branch: string; parent: string; depth: number; worktree: WorktreeFacts | null; parentCommitsSinceFork: number; behindTrunk: number; parentMerged: boolean }`; `type Feature = { name: string; kind: "stack" | "single" | "detached"; levels: Level[] }`; `groupFeatures(facts: RepoFacts): { name: string; kind: Feature["kind"]; branches: string[] }[]` (pure: stacks are edges connected to a branch whose parent is trunk, named by `grovefeature` or the root branch; singles are branches with a worktree outside any stack; all detached worktrees form one `detached` feature); `isMerged(cwd, tip: Sha, trunkRef: string): Promise<boolean>` (ancestor, or `merge-tree --write-tree trunk tip` equals trunk's tree); `readStackFacts(cwd, facts): Promise<Feature[]>`.

- [ ] **Step 1: Failing tests:** a stack main → `feat/api` → (`feat/ui`, `feat/admin`) groups into one feature with three levels and two at depth 2; a branch with no worktree and no stack is not a feature; two detached worktrees make one `detached` feature; after `merge --squash feat/api` into main, `isMerged(feat/api)` is true and `feat/ui`'s `parentMerged` is true; one new commit on `feat/api` gives `feat/ui.parentCommitsSinceFork === 1`.
- [ ] **Step 2–4:** fail, implement, pass; commit `feat: stacks, levels and squash-merge detection`.

### Task 8: Removal verdict

**Files:**
- Create: `src/core/facts/read-removal-facts.ts`, `src/core/facts/read-env-missing.ts`, `src/core/rules/safe-to-remove.ts`, `src/core/rules/verdict.types.ts`, `test/core/rules/safe-to-remove.test.ts`

**Interfaces:**
- Produces: `type Reason = { code: "uncommitted" | "untracked" | "unpushed" | "detached-only" | "stash" | "precious-ignored" | "too-many-ignored" | "nested-worktree"; detail: string; paths: string[] }`; `type Verdict = { ok: boolean; reasons: Reason[] }`; `readRemovalFacts(cwd, worktreePath, facts): Promise<RemovalFacts>` (I/O: changes, commits not on upstream and not merged into trunk, detached-only commits, stashes for its branch, precious ignored files, nested worktree paths); `safeToRemove(r: RemovalFacts): Verdict` (pure); `readEnvMissing(cwd, facts): Promise<Map<string, string[]>>` (worktree path → ignored `.env*` paths present in the main worktree and absent there), sharing the ignored-file listing.
- Precious ignored: `ls-files --others --ignored --exclude-standard --directory -z`, drop any path with a segment in `node_modules dist build .next .turbo .venv venv __pycache__ target .cache coverage`, expand folders, keep a file unless the main worktree has a byte-identical file at the same relative path; stop after 2,000 files with reason `too-many-ignored`.

- [ ] **Step 1: Failing tests:** a merged, clean, pushed worktree with `.local/seed.sql` gives `ok: false` and reason `precious-ignored` listing `.local/seed.sql`; the same worktree with only `node_modules/x.js` and an `.env` identical to main's gives `ok: true`; a worktree with another worktree inside its folder gives `nested-worktree`; a detached worktree with one commit on no branch gives `detached-only`; 2,001 files in an ignored `out/` give `too-many-ignored`; `readEnvMissing` reports `apps/web/.env.local` for a worktree that lacks it.
- [ ] **Step 2–4:** fail, implement, pass; commit `feat: safe-to-remove verdict`.

### Task 9: Rules and rollup

**Files:**
- Create: `src/core/rules/rule.types.ts`, `src/core/rules/registry.ts`, one file per rule in `src/core/rules/v1/` (`history-rewritten.ts`, `branch-deleted.ts`, `unsafe-merged-worktree.ts`, `nested-worktree.ts`, `operation-in-progress.ts`, `parent-merged.ts`, `parent-moved.ts`, `env-missing.ts`, `prunable.ts`, `idle.ts`), `src/core/rules/needs-you.ts`, `test/core/rules/rules.test.ts`

**Interfaces:**
- Produces: `type Severity = "loses-work" | "needs-action" | "waiting-on-review" | "idle"`; `type Finding = { rule: string; severity: Severity; subject: { kind: "branch" | "worktree" | "level"; id: string }; title: string; detail: string; action: string | null }`; `type RuleContext = { facts: RepoFacts; features: Feature[]; unresolved: JournalEntry[]; removals: Map<string, Verdict>; envMissing: Map<string, string[]>; now: number }`; `type Rule = { id: string; evaluate(ctx: RuleContext): Finding[] }`; `RULES: Rule[]`; `evaluate(ctx): Finding[]`; `needsYou(findings): Finding[]` (needs-action or worse, worst first, stable); `worst(findings): Severity | "fine"`.
- Severities, conditions and actions per the spec's v1 rules table (6.4b); `idle` after 14 days since `touchedAt`; `action` is the exact CLI command where one exists (`git grove restore <branch>`, `git grove rm --rescue <path>`).

- [ ] **Step 1: Failing tests:** each rule fires on a minimal hand-built `RuleContext` and stays silent on its negative; `needsYou` orders loses-work before needs-action and drops idle; `worst([])` is `"fine"`.
- [ ] **Step 2–4:** fail, implement, pass; commit `feat: rules v1 and rollup`.

### Task 10: CLI commands and install check

**Files:**
- Create: `src/cli/commands/status.ts`, `src/cli/commands/restore.ts`, `src/cli/commands/pins.ts`, `src/cli/commands/check.ts`, `src/cli/render-status.ts`, `test/cli/commands.test.ts`
- Modify: `src/cli/main.ts` (route commands), `README.md` (create: install and the four commands)

**Interfaces:**
- Consumes: everything above.
- Produces: `git grove status [--json]`, `git grove restore <branch> [<pin-ref>]`, `git grove pins list [<branch>]`, `git grove check remove <worktree> [--json]`. `status` runs `observe`, reads facts and stack facts, removal verdicts only for worktrees whose branch is merged, evaluates rules, and prints "Needs you" then one line per worktree (shape A in `docs/mockups/cli-output.html`); `--json` prints `{ repo, trunk, features, findings, journal }` and nothing else on stdout. `check remove` exits 0 when safe, 3 when not (reasons on stdout), 1 on error.

- [ ] **Step 1: Failing tests** calling `run(argv, io)` in temp repos: after a squash, `status --json` parses and has one finding with `rule === "history-rewritten"`; `restore` then `status --json` has none; `check remove .worktrees/old` exits 3 and prints `.local/seed.sql`; `pins list` prints the pin ref; `status` outside a repo exits 1 with one line on stderr.
- [ ] **Step 2–4:** fail, implement, pass.
- [ ] **Step 5:** `scripts/smoke-install.sh` extended: in the temp repo, squash a branch and expect `git grove status` to print `history rewritten`. Run it; expect pass.
- [ ] **Step 6:** Commit `feat: status, restore, pins and check commands`.

---

Not in this slice (later plans): the reflog catch-up and first-add summary (spec 6.3), `new` / `add-level` (6.6b), the guard (6.6), the watcher and server (6.1, 6.8), GitHub data (6.9), `git grove demo` (6.11).
