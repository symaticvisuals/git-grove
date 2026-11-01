# git-grove UI slice: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every action in the approved dashboard (restore, ack, restack, new feature, add level, rescue-remove, clean up) runs from a live local dashboard and from the CLI through one plan/run core, served at login by a per-user service as an installable web app.

**Architecture:** `src/core/actions` turns each action into a `Prepared`: a `Plan` to show plus an `execute` closure. `runPrepared` takes the repo lock, re-checks every expectation the plan read, pins every branch it will move, runs the steps while emitting step events, and records a receipt. The CLI prints a plan and runs it in-process. `src/server` (node:http on 127.0.0.1, token cookie plus Host check) serves a read API from cached snapshots. fs.watch and a 30 s poll keep those snapshots fresh, and the server pushes digests, activity and step events over SSE. It runs plans it prepared itself, by id. `ui/` is plain TypeScript ported from the mockup and bundled by esbuild into `dist/ui`.

**Tech Stack:** Node ≥ 24 (`node:http`, `node:sqlite`, recursive `fs.watch`, `node:crypto`), TypeScript 7 strict with NodeNext ESM, esbuild (devDependency only), vitest against real temporary git repos, and headless Chrome once to render icons.

**Spec:** `docs/superpowers/specs/2026-11-01-git-grove-design.md`: 6.5, 6.6b, 6.7, 6.8, 6.10, 7 and 9, in the working-tree version that includes today's 6.8 edits. The UI to build is `docs/mockups/dashboard.html`, with brand tokens in `docs/brand/`. Conventions follow `docs/superpowers/plans/2026-11-01-git-grove-brain.md`.

## Global Constraints

- Work on branch `feat/ui`, stacked on `feat/brain`. Do not modify `src/core/stacks/is-merged.ts`, `src/core/journal/classify-tip-change.ts` or `src/core/rules/v1/prunable.ts`; they are being fixed on feat/brain.
- `"engines": { "node": ">=24" }`. Zero runtime dependencies. `esbuild` is the only new devDependency. `"files": ["dist"]` ships `dist/ui`.
- TypeScript strict, no `any`, NodeNext with `.js` import suffixes. kebab-case files, one exported abstraction per file, custom errors in `*.error.ts`. JSDoc only on exports, kept short.
- Only `src/core/runner` and `src/core/actions` change git. Every action takes `<commonDir>/grove.lock`, pins every branch it moves before moving it, and never pushes. Read-only git goes through `runGit` (which adds `--no-optional-locks`); writes pass `write: true`.
- `src/core` never imports from `src/server`, `src/cli` or `ui/`. `ui/` imports only types from `src/`.
- Server: binds `127.0.0.1` only. Port `47683`, else the next free port up to `47702`. Writes `$GIT_GROVE_HOME/server.json` `{ "pid", "port", "version" }`. The token is `$GIT_GROVE_HOME/token`: 32 random bytes as hex, mode 0600. The cookie is `grove_token`; POST requests carry the header `X-Grove-Token`. `GIT_GROVE_HOME` defaults to `~/.git-grove`.
- Login service: the launchd label is `work.grove.server` at `~/Library/LaunchAgents/work.grove.server.plist`; the systemd user unit is `~/.config/systemd/user/git-grove.service`. Both run `<node> <abs dist/cli/bin.js> serve`.
- Exit codes for action commands: 0 done, 3 blocked (the plan has blockers, nothing changed), 1 refused, stopped or error.
- Copy uses the mockup's wording where the mockup has it, in plain English.
- Tests: vitest, real temp repos via `test/support/make-repo.ts`, a temp `GIT_GROVE_HOME` per suite, servers on port 0, `GIT_GROVE_NO_OPEN=1`. UI tests sit under `test/ui/` and test pure modules only.
- Run one task's tests with `pnpm vitest run <files>`; the expected failure before implementing is a missing module. Before each commit run `pnpm typecheck && pnpm test`.
- Commits are `feat: …` with no AI attribution lines.

## Review Focus

1. **Cross-origin and DNS-rebinding requests.** A page on any other origin, or on a rebound hostname, must not be able to read or change anything. That includes `localhost:<other port>`, because cookies ignore ports and that page is same-site. Defences: the Host check returns 421; POST needs `X-Grove-Token`, a same-origin `Origin`/`Sec-Fetch-Site` and a JSON body; no response carries CORS headers; the cookie is HttpOnly so no page can read the token; GET has no side effects. Tests in Task 5; `/events` in Task 7.
2. **State changes between plan and run.** An agent commits, edits a file or moves a parent while a dialog is open. The run refuses, changes nothing and says what moved. Tests in Task 1 (core), Task 8 (API) and Task 4 (the re-check before each removal).
3. **Two runners at once** (a dashboard tab and the CLI, or two tabs). The repo lock refuses the second run with "Another grove action is running in this repo". One plan cannot run twice. A lock left by a dead process is taken over. Tests in Tasks 1 and 8.
4. **A restack conflict mid-stack.** The run stops at that level, aborts its rebase and puts its set-aside change back. Lower levels stay done, everything stays pinned and no rebase is left in progress. A user's `rebase.updateRefs` must not move other branches. Tests in Task 2.
5. **A machine with no launchd or systemd** (a container, SSH without a user bus, or an npx cache path). `ui` serves in the foreground, `service install` explains and exits 1, and nothing is half-written. Tests in Task 11.
6. **Agent-written text rendered in the dashboard** (branch names, commit subjects, paths). It is always escaped, so `<img src=x onerror=…>` shows as text; the CSP forbids inline script. Tests in Tasks 9 and 10.
7. **The server restarts under an open tab.** The UI shows "git grove isn't running" instead of going blank, reconnects, and offers a reload when the version changed. Tests in Task 9.

## Layout

```
src/core/actions/   plan.types.ts action.types.ts registry.ts run-prepared.ts check-expectations.ts …
                    restore-action.ts ack-action.ts restack/ create/ remove/
src/core/snapshot/  read-snapshot.ts (status and the server share it)
src/server/         start-server.ts auth/ http/ api/ wire/ live/ actions/
src/cli/commands/   serve.ts ui.ts service.ts (+ routes for new, add-level, restack, stack plan, rm)
ui/                 index.html styles.css public/ src/ (render/, dialogs/, palette/), sw.ts
scripts/            build-ui.mjs render-icons.sh
```

---

### Task 1: Action framework, with restore and ack as its first actions

**Files:**
- Create: `src/core/actions/plan.types.ts`, `src/core/actions/action.types.ts`, `src/core/actions/registry.ts`, `src/core/actions/run-prepared.ts`, `src/core/actions/check-expectations.ts`, `src/core/actions/read-dirty-paths.ts`, `src/core/actions/read-lane.ts`, `src/core/actions/stale-plan.error.ts`, `src/core/actions/invalid-input.error.ts`, `src/core/actions/restore-action.ts`, `src/core/actions/ack-action.ts`, `src/core/journal/alert-pin.ts`, `src/core/journal/settle-restored-tip.ts`, `src/core/runner/pid-lock.ts`, `src/core/runner/lock-held.error.ts`, `src/cli/render-plan.ts`, `src/cli/run-action.ts`
- Modify: `src/core/runner/restore.ts` (extract `restoreHeld`), `src/core/runner/with-repo-lock.ts` (use `acquirePidLock`), `src/cli/commands/restore.ts` (import `alertPin` and `settleRestoredTip` from core), `src/core/journal/open-store.ts` and `store.types.ts` (add `repos`, `addActivity`, `activity`), `src/cli/describe-error.ts` (`InvalidInputError` is a one-line error)
- Test: `test/core/actions/run-prepared.test.ts`, `test/core/runner/with-repo-lock.test.ts`

**Interfaces:**
- Produces, in `plan.types.ts`:

```ts
type ActionName = "restore" | "ack" | "restack" | "new" | "add-level" | "copy-env" | "remove" | "cleanup";
type Check = { ok: boolean; text: string; why: string | null };
type LaneCommit = { sha: string; subject: string; tip: boolean; base: boolean; lost: boolean; pinned: boolean };
type Lane = { caption: string; commits: LaneCommit[] }; // oldest first, the base row first
type FolderLine = { path: string; isNew: boolean; note: string };
type Choice = { id: string; label: string; detail: string; selectable: boolean; selected: boolean; health: "loses" | "fine" | "idle" };
type Expectation =
  | { kind: "tip"; branch: string; sha: Sha | null }  // null: the branch must not exist
  | { kind: "worktree"; path: string; head: Sha | null; dirty: string[]; operation: Operation | null }
  | { kind: "absent"; path: string };
type Plan = {
  action: ActionName; context: string; title: string; summary: string; confirm: string;
  before: Lane | null; after: Lane | null; folders: FolderLine[] | null; choices: Choice[] | null;
  checks: Check[]; effects: string[]; commands: string[]; steps: { title: string; detail: string }[];
  blockers: string[]; note: string | null; undoable: boolean; moves: string[]; expects: Expectation[];
};
type StepEvent = { index: number; state: "running" | "done" | "failed" | "skipped"; detail: string; ms: number | null };
type RestoreTarget = { branch: string; pinRef: string };
type Receipt = { action: ActionName; ok: boolean; refused: boolean; title: string; lines: string[]; pins: string[]; undo: RestoreTarget[] | null; at: number };
```

- In `action.types.ts`: `ActionContext = { root: string; store: Store; now: () => number }`; `RunContext = { facts: RepoFacts; pins: Map<string, string>; step(index: number, work: () => Promise<string>): Promise<string>; skip(index: number, why: string): void }`; `ExecuteResult = { ok: boolean; title: string; lines: string[]; undo: RestoreTarget[] | null }`; `Prepared = { plan: Plan; execute(run: RunContext): Promise<ExecuteResult> }`; `ActionDef = { name: ActionName; prepare(ctx: ActionContext, raw: unknown): Promise<Prepared> }` (throws `InvalidInputError`).
- `ACTIONS: Partial<Record<ActionName, ActionDef>>`, and `prepareAction(name: ActionName, ctx, raw: unknown): Promise<Prepared>` (throws `InvalidInputError("unknown action")` for a missing entry). Later tasks register their actions here.
- `runPrepared(ctx: ActionContext, prepared: Prepared, emit: (event: StepEvent) => void): Promise<Receipt>`. It never throws for refusals or stops.
- `checkExpectations(facts: RepoFacts, expects: Expectation[]): Promise<string[]>` returns one line per mismatch: `"feat moved: was f01aa41, now 9c2e0b1"`, `"src/x.ts changed in .worktrees/a"`, `".worktrees/b now exists"`.
- `readDirtyPaths(worktreePath: string): Promise<string[]>`, sorted, from `status --porcelain=v2 -z --untracked-files=all`.
- `readLane(cwd: string, base: Sha, tip: Sha, options: { caption: string; baseLabel: string; lost?: ReadonlySet<Sha>; pinned?: Sha | null; limit?: number }): Promise<Lane>`, with `limit` defaulting to 12.
- `restoreHeld(facts: RepoFacts, branch: string, pinRef?: string, beforeMove?: () => Promise<void>): Promise<RestoreResult>`. It is the old body of `restore`; the caller holds the lock. `restore` keeps its signature and behaviour.
- `alertPin(store, facts, branch): string | undefined` and `settleRestoredTip(store, facts, branch, tip): Promise<void>`, both moved verbatim from `src/cli/commands/restore.ts`, where the second is `settleJournal` today. Its helper `parentTipOf` moves with it.
- `acquirePidLock(path: string): Promise<() => Promise<void>>` creates the file with `wx` and writes the pid. On `EEXIST` it reads the pid: when it parses and `process.kill(pid, 0)` throws `ESRCH`, it removes the file and retries once. Otherwise it throws `LockHeldError { path, pid: number | null }`. An empty file counts as held.
- Store: `repos(): { id: number; commonDir: string; root: string }[]`; `addActivity(repoId, item: { kind: "action" | "worktree-added" | "worktree-removed" | "scan-error"; branch: string | null; title: string; detail: string; at: number }): number`; `activity(repoId: number | null, limit: number): StoredActivity[]`, newest first. `StoredActivity` is that item plus `id` and `repoId`, in a new table `activity`.
- `renderPlan(plan): string`, `renderStepEvent(plan, event): string`, `renderReceipt(receipt): string`. `runActionCommand(io: CliIo, name: ActionName, raw: unknown, options: { dryRun: boolean; json: boolean }): Promise<number>` prints the plan (or its JSON when `--json --dry-run`), exits 3 on blockers, 0 on `--dry-run`, otherwise runs with step lines and prints the receipt (JSON with `--json`).

- [ ] **Step 1: Failing tests.** The fixture is main plus `feat` with 3 commits in worktree `.worktrees/feat`: observe, squash (`reset --soft main && commit`), observe again.
  - `restore plan shows the 3 commits coming back and the exact command`: `plan.after.commits.filter((c) => !c.base).length === 3`; ``plan.commands[0] === `git grove restore feat ${pinRef}` ``; `plan.blockers` is `[]`; `plan.moves` is `["feat"]`; `plan.confirm === "Bring back 3 commits"`.
  - `running it brings the commits back, pins the squash and offers it as undo`: `receipt.ok`; `rev-list --count main..feat` is `"3"`; `receipt.undo[0].pinRef` resolves to the squash sha; `store.entries(id, { unresolved: true })` is empty.
  - `a branch that moves after the plan is refused and nothing changes`: commit in the worktree after `prepare`. Then `receipt.refused`, `receipt.title === "Changed since you looked"`, `receipt.lines[0]` matches `/^feat moved/`, the tip is still the new commit, and the pin count is unchanged.
  - `a file added in the worktree after the plan is refused`: `receipt.lines` names the path.
  - `a run while the repo lock is held is refused`: run inside `withRepoLock(commonDir, …)`; `receipt.title === "Another grove action is running in this repo"`.
  - `a plan with blockers runs nothing`: dirty the worktree before `prepare`. `plan.blockers[0]` contains `"uncommitted changes"`; `receipt.title === "Not run"`.
  - `step events go running then done for each step in order`, and `steps a stopped run never reached are reported skipped`. For the second, use a stub `Prepared` whose `execute` returns `ok: false` after step 0.
  - `every receipt is recorded as activity`: `store.activity(repoId, 1)[0]` matches `{ kind: "action", title: receipt.title }`.
  - `ack plan clears the branch's alerts and changes nothing in git`: tips are identical before and after; `plan.undoable === false`; `plan.commands` is `["git grove ack feat"]`.
  - `with-repo-lock.test.ts`:
    - `a lock whose pid no longer runs is taken over`: get a dead pid from `spawnSync(process.execPath, ["-e", ""]).pid`.
    - `a lock held by a running process is refused` (`process.pid`), throwing `RepoLockedError`.
    - `an empty lock file counts as held`.
- [ ] **Step 2:** Run the tests; they fail.
- [ ] **Step 3: Implement.** `runPrepared` works in this order:
  1. Blockers make a refused receipt titled `"Not run"`, with the blockers as its lines.
  2. `withRepoLock(commonDir)`: `RepoLockedError` makes a refused receipt.
  3. `readRepoFacts(root)`, then `checkExpectations`. Mismatches throw `StalePlanError`, which makes a refused receipt titled `"Changed since you looked"`, with the mismatches as its lines.
  4. Pin each `plan.moves` branch at its current tip and record it in `run.pins`.
  5. `execute`. A thrown `RefusedError` is refused; any other throw has `ok: false` and the title `"Stopped: <step title>"`.
  6. Emit `skipped` for every step index never reported.
  7. `store.addActivity` the receipt, as `{ kind: "action", title, detail: lines.join("; ") }`.

  `restoreAction` takes input `{ targets: { branch: string; pinRef?: string }[] }` with at least one target; a missing pin means `alertPin`, else the newest pin. Its plan:
  - `before`: the "Now" lane; `after`: the pin's lane, with `base = merge-base(current, pin)`.
  - `checks`: the holder worktree is clean, and no operation is in progress.
  - `effects`, per the mockup's "Grove will also" list.
  - `steps`: `["Check nothing moved since you looked", "Pin the current tip", "Move the branch back", "Check all N commits are back"]`.
  - `undoable: true`; `moves` are the branches; `expects` are each tip plus the holder worktree.

  Its `execute` calls `restoreHeld` and then `settleRestoredTip` for each target; `undo` is each `pinnedCurrent`. `ackAction` takes input `{ branch }`. With no open alert it is blocked with `"Nothing to acknowledge on <branch>"`. Its `confirm` is `"Keep the squash"`, its `note` is `"Nothing in git changes."`, and its effects are the mockup's three lines.
- [ ] **Step 4:** Run the tests, plus all existing tests; they pass. Commit `feat: plan and run actions, with restore and ack`.

### Task 2: Restack

**Files:**
- Create: `src/core/stacks/fork-of.ts` (moved out of `read-stack-facts.ts`, adding `hint`), `src/core/stacks/find-feature.ts`, `src/core/actions/restack/order-restack.ts`, `src/core/actions/restack/predict-conflicts.ts`, `src/core/actions/restack/restack-action.ts`, `test/support/make-stack.ts`
- Modify: `src/core/stacks/read-stack-facts.ts`, `src/core/actions/registry.ts`, and `src/cli/main.ts`, which gets the routes `restack <feature> [--stash] [--dry-run] [--json]` and `stack plan <feature> [--json]` (the same as `restack --dry-run`) and the options `stash` and `dry-run`; usage lines too
- Test: `test/core/actions/order-restack.test.ts`, `test/core/actions/restack-action.test.ts`, `test/cli/restack-command.test.ts`

**Interfaces:**
- Consumes: `ActionDef`, `runPrepared`, `readDirtyPaths`, `readStackFacts`, `classifyTipChange`, `store.lastTips`.
- Produces:
  - `forkOf(cwd, edge: StackEdge | undefined, branch: BranchFacts, parent: BranchFacts, hint?: Sha | null): Promise<Sha>` tries config `stackforkpoint`, then `hint`, then `merge-base`. A candidate counts only when it is an ancestor of the branch tip.
  - `findFeature(features: Feature[], nameOrBranch: string): Feature | null` matches by name first, then by any level's branch.
  - `orderRestack(feature: Feature, trunkName: string): { moves: RestackMove[]; untouched: string[] }`, with `RestackMove = { branch: string; onto: string; ontoTrunk: boolean; reason: "parent-moved" | "parent-merged" | "parent-restacked" }`. It is pure, parent before child. Level 1 never moves. A level moves onto the trunk when `parentMerged`, onto its parent when `parentCommitsSinceFork > 0`, and onto its parent when its parent moves.
  - `predictConflicts(cwd, fork: Sha, onto: Sha, tip: Sha): Promise<string[] | null>` uses `git merge-tree --write-tree --name-only --no-messages --merge-base <fork> <onto> <tip>`. Exit 1 returns the conflicted paths. A usage error returns null, and the check then reads "Conflicts not checked (needs git 2.40)".
  - `restackAction` takes input `{ feature: string; stash?: boolean }`.
  - `makeStack(repo, { feature, levels: { branch, parent, file }[] }): Promise<Record<string, string>>` maps each branch to its worktree path. It creates `.worktrees/<feature>/<NN>-<branch with / as ->`, commits `file` there, and sets `stackparent`, `stackforkpoint` and (on the root) `grovefeature`.

- [ ] **Step 1: Failing tests.** The fixture is `makeStack` main → `feat/model` (01) → `feat/ui` (02) → `feat/email` (03), then one commit on `feat/model`, then `feat/admin` (02, on model; up to date).
  - `order-restack.test.ts`, on hand-built `Feature`s:
    - `level 1 never moves`
    - `a child of a moving level moves even when it did not drift`
    - `a level whose parent merged moves onto the trunk`
    - `admin with no drift stays in untouched`
  - `plan moves ui then email and leaves admin alone`: the step titles equal `["Pin every level that moves", "Move feat/ui onto feat/model", "Move feat/email onto feat/ui", "Check nothing was lost"]`; `plan.checks` contains `{ ok: true, text: "02 feat/ui onto 01 feat/model" }` and `{ ok: true, text: "02 feat/admin is already up to date", why: "Left alone" }`; `plan.confirm === "Restack 2 levels"`; every rebase command contains `rebase --no-update-refs --no-autosquash --onto`.
  - `the run puts each moved level on its parent and records the new fork points`: `isAncestor(model, ui)` and `isAncestor(ui, email)`; `branch.feat/ui.stackforkpoint` equals model's tip; `receipt.title === "Restacked 2 levels"`; `receipt.pins.length === 2`; `receipt.undo.length === 2`.
  - `an uncommitted change blocks unless set aside, and set aside it comes back unchanged`: give ui one modified tracked file and one untracked file. With `stash: false`, `plan.blockers[0]` contains `"has uncommitted changes. Turn on set aside, or commit them first."`. With `stash: true`, the two files are byte-identical after the run and `git stash list` there is `""`.
  - `a conflict on level 03 stops there and keeps level 02 done`: email and the new model commit both edit line 1 of `shared.txt`, and email also holds an untracked file set aside.
    - `receipt.ok === false`; `receipt.title === "Stopped at level 03: conflict in shared.txt"`.
    - email's tip is unchanged, the untracked file is back, and `rebase-merge` is absent from email's git dir.
    - `isAncestor(model, ui)` holds; `receipt.lines` includes `"feat/ui is restacked and stays done"`; pins exist for ui and email.
  - `the plan predicts that conflict`: email's check is `{ ok: false, why: "conflicts likely in shared.txt" }`.
  - `a parent squash-merged into main moves the child onto main and records main as its parent`: `stackparent` is `"main"`; `rev-list --count main..feat/ui` is `"1"`.
  - `a level with an unresolved rewrite blocks the restack`: the blocker contains `"restore or keep"`.
  - `rebase.updateRefs in the user's config moves no other branch`: branch `side` at ui's old tip keeps its sha.
  - `restack-command.test.ts`:
    - `restack --dry-run prints the plan and changes nothing` (exit 0, tips unchanged)
    - `restack runs and prints each step and the receipt` (exit 0, output contains `"Restacked 2 levels"`)
    - `a blocked restack exits 3`
    - `stack plan <feature> --json prints the plan` (`JSON.parse(out).action === "restack"`)
    - `restack accepts any branch of the feature`
- [ ] **Step 2:** Run the tests; they fail.
- [ ] **Step 3: Implement.**

  Prepare reads facts and stack facts, then `findFeature`. Anything other than a `stack` is invalid input. With nothing to move, the blocker is `"Nothing to restack: every level is on top of its parent"`. Each moving level is blocked when it has no worktree (`"<branch> has no worktree; restack it by hand"`), when an operation is in progress, when it is dirty and `stash` is off, or when any level of the feature has an unresolved rewrite (`"<branch> has a rewrite to restore or keep first"`).

  The fork comes from `forkOf(…, hint = store.lastTips(repoId).get(branch)?.parentSha)`; for `ontoTrunk` it is taken against the old parent. Onto is the parent's tip, or `facts.trunk.ref`. `expects` holds every feature branch tip, the trunk tip and each moving worktree; `moves` lists the moving branches.

  Execute, per move, in order:
  1. When dirty: `git stash push --include-untracked -m "grove restack <feature>"`.
  2. In the level's worktree: `git rebase --no-update-refs --no-autosquash --onto <onto sha> <fork> <branch>`, with `GIT_EDITOR=true`. Onto is resolved now, so it picks up a parent this run just moved.
  3. On success: set `stackforkpoint`, plus `stackparent` = trunk name when `ontoTrunk`. Then pop with `stash pop --index`, retrying with plain `stash pop` if that exits non-zero without touching files. If the pop still fails, stop with the line `"Your change is kept in the stash of <folder>; it did not apply cleanly"`.
  4. On a non-zero rebase: read the conflicted paths (`diff --name-only --diff-filter=U`), run `rebase --abort`, pop any set-aside change, and return `ok: false` with the title above.

  The final step runs `classifyTipChange({ oldTip: pin, newTip, oldBase: fork, newBase: onto })` for each moved level. Any kind other than `rebased` or `advanced` gives `ok: false` with `"<branch> lost N changes; git grove restore <branch> <pin>"`.
- [ ] **Step 4:** Run the tests; they pass. Commit `feat: restack a stack, setting changes aside and stopping cleanly on conflict`.

### Task 3: New feature, add level and copy env

**Files:**
- Create:
  - `src/core/grove-home.ts`, `src/core/config/read-config.ts`, `src/core/open/app-command.ts`, `src/core/open/launch-detached.ts`
  - `src/core/facts/list-main-env-files.ts`
  - `src/core/actions/create/level-folder.ts`, `src/core/actions/create/copy-env-files.ts`, `src/core/actions/create/detect-install.ts`
  - `src/core/actions/create/new-feature-action.ts`, `src/core/actions/create/add-level-action.ts`, `src/core/actions/create/copy-env-action.ts`
- Modify:
  - `src/core/facts/read-env-missing.ts` (use `listMainEnvFiles`) and `src/core/journal/open-store.ts` (default path via `groveHome`)
  - `src/core/actions/registry.ts`
  - `src/cli/main.ts`: routes `new <feature>` and `add-level <feature> <branch>`; options `branch`, `from`, `on` (strings) and `skip-env`, `install`, `open` (booleans); plus `dry-run`/`json`
- Test: `test/core/actions/level-folder.test.ts`, `test/core/actions/create-actions.test.ts`, `test/cli/create-commands.test.ts`

**Interfaces:**
- Produces:
  - `groveHome(): string`, returning `GIT_GROVE_HOME`, else `~/.git-grove`.
  - `readConfig(): Promise<GroveConfig>`, with `GroveConfig = { editor: string[] | null; terminal: string[] | null }`, read from `groveHome()/config.json`. A missing or unreadable file gives nulls.
  - `appCommand(app: "editor" | "terminal", path: string, config: GroveConfig, platform: NodeJS.Platform): { argv: string[]; cwd: string }`. The defaults are `["code", path]`, `["open", "-a", "Terminal", path]` on darwin and `["x-terminal-emulator"]` with `cwd = path` on linux. A configured argv gets the path appended.
  - `launchDetached(cmd: { argv: string[]; cwd: string }): Promise<void>` spawns detached with `stdio: "ignore"` and unrefs, resolves on `spawn`, and rejects with `"<argv[0]> not found; set it in ~/.git-grove/config.json"` on `ENOENT`.
  - `listMainEnvFiles(facts): Promise<string[]>` lists the main worktree's ignored `.env*` files, relative.
  - `copyEnvFiles(main: string, target: string, files: string[]): Promise<{ copied: string[]; kept: string[] }>`. It never overwrites (`COPYFILE_EXCL`), and `kept` lists files that already existed.
  - `detectInstall(mainPath: string): { argv: string[]; label: string } | null` maps lockfiles in this order: `pnpm-lock.yaml` → `pnpm install`, `yarn.lock` → `yarn install`, `bun.lock` or `bun.lockb` → `bun install`, `package-lock.json` → `npm install`.
  - `slugOf(text): string` lowercases, turns each run of `[^a-z0-9]` into `-` and trims. `levelFolder(root, feature: string, depth: number, branch: string): string` is `<root>/.worktrees/<slugOf(feature)>/<NN>-<branch with each / replaced by ->`.
  - `newFeatureAction` takes `{ feature: string; branch?: string; from?: string; env?: boolean; install?: boolean; open?: boolean }`, with defaults `branch = slugOf(feature)`, `from = trunk.ref`, `env = true`, `install = false`, `open = false`.
  - `addLevelAction` takes `{ feature: string; branch: string; on?: string; env?: boolean; install?: boolean; open?: boolean }`, where `on` defaults to the deepest level, the last one found when several share that depth.
  - `copyEnvAction` takes `{ worktree: string }`.

- [ ] **Step 1: Failing tests**
  - `level-folder.test.ts`:
    - `levelFolder("/r", "gift cards", 1, "feat/gift-cards-model") === "/r/.worktrees/gift-cards/01-feat-gift-cards-model"`
    - `slugOf("  Checkout: Coupons! ") === "checkout-coupons"`
    - depth 12 gives `12-…`
    - `appCommand("terminal", "/w", { editor: null, terminal: null }, "darwin").argv` is `["open", "-a", "Terminal", "/w"]`
    - `detectInstall` returns each of the four lockfiles' commands, and `null` with none.
  - `new creates the first level on main and records the stack keys`: the worktree at `levelFolder(…)` is on `feat/gift-cards-model`. `stackparent` is `"main"`, `grovefeature` is `"gift cards"` and `stackforkpoint` is main's sha. `readStackFacts` has the feature `"gift cards"` with 1 level. `plan.folders` ends with `{ path: "01-feat-gift-cards-model", isNew: true, note: "on main" }`.
  - `new copies main's ignored .env files and prints the install command without running it`: `.env` and `apps/web/.env.local` are byte-identical in the new folder, and `plan.effects` contains ``"Run `pnpm install` in the new folder when you need it"``.
  - `new with install runs the package manager in the new folder`: a fake `pnpm` script on `PATH` touches `installed` there.
  - `new refuses an existing branch, an existing folder or an existing feature name, and changes nothing`.
  - `new from a branch that is not the trunk is invalid`: it throws `InvalidInputError` mentioning `add-level`.
  - `new ignores .worktrees/ in this clone when the repo does not`: `info/exclude` contains `.worktrees/`.
  - `add-level builds on the deepest level by default, and --on level 1 makes a sibling 02-`: folders `03-…` and `02-…`, each with `stackparent` set to its parent.
  - `add-level on an unknown feature is invalid`.
  - `copy-env copies apps/web/.env.local into a worktree that lacks it and never overwrites`: a pre-existing `.env` that differs is kept.
  - `create-commands.test.ts`:
    - `new "gift cards" --branch feat/gift-cards-model exits 0 and prints Ready`
    - `add-level "gift cards" feat/gift-cards-ui exits 0`
    - `new with an existing branch exits 3`
- [ ] **Step 2:** Run the tests; they fail.
- [ ] **Step 3: Implement.** `from` must be the trunk name or `facts.trunk.ref`; the fork point is its sha.

  New's plan:
  - Steps: `"Create branch <b> and its folder"` (`git worktree add -b <b> <path> <sha>`), `"Record it as level 01 of <feature>"` (three `git config` writes), then the optional `"Ignore .worktrees/ in this clone"`, `"Copy N env files"`, `"Install dependencies"` and `"Open in your editor"`.
  - `note`: `"Nothing that exists today is changed."`; `confirm`: `"Create"`; `moves: []`.
  - `expects`: the branch absent (`sha: null`), the folder absent, and the trunk tip.

  An install that fails, or runs past its 10 min timeout, does not stop the run: the receipt stays `ok`, with the line `"install failed: <last stderr line>; run <label> there yourself"`. The same goes for a failed editor launch. Add-level records `stackparent = on` and `stackforkpoint = on`'s tip, with no `grovefeature`.
- [ ] **Step 4:** Run the tests; they pass. Commit `feat: new features and levels in the grouped layout, with env copy`.

### Task 4: Rescue-remove and clean up

**Files:**
- Create: `src/core/facts/read-merged-removals.ts` (moved from `status.ts`), `src/core/actions/remove/rescue-target.ts`, `src/core/actions/remove/rescue-files.ts`, `src/core/actions/remove/rescue-failed.error.ts`, `src/core/actions/remove/remove-worktree-safely.ts`, `src/core/actions/remove/remove-action.ts`, `src/core/actions/remove/cleanup-action.ts`
- Modify: `src/cli/commands/status.ts` (import the moved function), `src/core/actions/registry.ts`, `src/cli/main.ts` (route `rm <worktree> [--rescue]`, resolving the path from `io.cwd`)
- Test: `test/core/actions/remove-actions.test.ts`, `test/cli/rm-command.test.ts`

**Interfaces:**
- Consumes: `readRemovalFacts`, `safeToRemove`, `findWorktree`, `sameFileInBoth`.
- Produces:
  - `readMergedRemovals(facts): Promise<Map<string, Verdict>>`, the old `mergedRemovals` plus `verdictFor`.
  - `rescueTarget(relative: string, folder: string, existsInMain: (rel: string) => boolean): string` returns `relative`, else `<relative>.from-<folder>`, else `<relative>.from-<folder>-2` and so on.
  - `rescueFiles(main: string, worktree: string, files: string[], copy?: (from: string, to: string) => Promise<void>): Promise<{ from: string; to: string }[]>` copies with `COPYFILE_EXCL`, creating parents. It compares SHA-256 of source and copy, and throws `RescueFailedError(path)` on a mismatch or failure.
  - `removeWorktreeSafely(root: string, path: string, rescued: ReadonlySet<string>): Promise<{ removed: true } | { removed: false; reasons: string[] }>` re-reads facts and removal facts. Precious files listed in `rescued` count as safe; any other reason stops it. Otherwise it runs `git worktree remove <path>` without `--force`.
  - `removeAction` takes input `{ worktree: string; rescue: boolean }`; `cleanupAction` takes `{ paths?: string[] }`.

- [ ] **Step 1: Failing tests.** The fixture is a squash-merged branch in `.worktrees/old`, holding `.local/seed.sql` (ignored).
  - `rm --rescue copies .local/seed.sql into main, checks it, removes the folder and keeps the branch`: main's copy is byte-identical; the path is gone from `git worktree list`; `rev-parse --verify old` succeeds; `receipt.title === "Cleaned up .worktrees/old"`.
  - `a different seed.sql already in main stays, and the copy lands at .local/seed.sql.from-old`.
  - `without rescue, precious files block, and the blocker names the command`: `plan.blockers[0]` contains `"git grove rm --rescue .worktrees/old"`.
  - `uncommitted work blocks even with rescue`.
  - `the main, a locked and a prunable worktree are blocked with their reason`.
  - `an ignored file added after the plan is caught by the re-check and nothing is removed`: `receipt.ok === false`; `receipt.title === "Stopped before removing .worktrees/old"`; the worktree remains, and main holds the planned copy.
  - `a copy that does not match stops before removing`: a `copy` seam writes other bytes; nothing is removed.
  - `cleanup offers merged and detached worktrees and removes the picked ones`: an unmerged worktree is not offered; `choices` holds the merged one (selectable, detail `"copies 1 file to main first"`) and a detached sandbox (`"nothing to keep"`); after the run both are gone and every branch remains.
  - `cleanup skips one that gained a precious file after the plan and removes the rest`: that step is `skipped`; `receipt.ok === false`; the receipt lines name it.
  - `cleanup with nothing picked is blocked with "Pick at least one worktree."`.
  - `rm-command.test.ts`:
    - `rm --rescue exits 0`
    - `rm on precious files exits 3 and names --rescue`
    - `rm of the main worktree exits 3`
    - `rm resolves the path from the folder it runs in`
- [ ] **Step 2:** Run the tests; they fail.
- [ ] **Step 3: Implement.**

  Remove's blockers:
  - every verdict reason except `precious-ignored` (and that one too when `rescue` is off), shown as `detail: paths`;
  - `"the main worktree is never removed"`;
  - `"locked; unlock it with git worktree unlock first"`;
  - `"its folder is gone; run git worktree prune"`.

  Remove's plan:
  - `checks`, per the mockup's "Safe to remove?" list: "Merged into <trunk>"; "No uncommitted, untracked, stashed or unpushed work"; "No worktree inside this folder"; `"N ignored files exist only here"`, with the paths and sizes as `why`.
  - `steps`: `"Copy <f> to main"` for each file, then `"Check the copy matches"`, `"Check it's safe to remove"` and `"Remove the worktree folder"`.
  - `commands`: `cp …`, `git grove check remove <rel>`, `git worktree remove <rel>`.
  - `expects`: the worktree and its branch tip; `moves: []`; `undoable: false`.

  Cleanup's candidates are `readMergedRemovals`, plus every non-prunable detached worktree with its own verdict. A candidate is selectable when its verdict is ok, or its only reason is `precious-ignored`. The default pick is every selectable candidate. A path not in the choices is invalid input. A failed re-check marks that worktree's steps `skipped` and moves on to the next.
- [ ] **Step 4:** Run the tests; they pass. Commit `feat: rm --rescue and clean up, re-checking each worktree before it goes`.

### Task 5: Server core

**Files:**
- Create: `src/server/start-server.ts`, `src/server/server-context.types.ts`, `src/server/server-running.error.ts`, `src/server/server-file.ts`, `src/server/auth/check-request.ts`, `src/server/auth/read-or-create-token.ts`, `src/server/http/router.ts`, `src/server/http/http.error.ts`, `src/server/http/send.ts`, `src/server/http/read-json-body.ts`, `src/server/http/serve-static.ts`, `src/server/api/register-api.ts`, `src/cli/commands/serve.ts`
- Modify: `src/cli/main.ts` (route `serve [--port <n>]`), `src/cli/describe-error.ts` (`ServerRunningError`)
- Test: `test/server/check-request.test.ts`, `test/server/start-server.test.ts`, `test/support/server-request.ts`

**Interfaces:**
- Consumes: `acquirePidLock`, `groveHome`, `openStore`.
- Produces:
  - `startServer(options: { port?: number; home?: string; uiDir?: string; version: string; onShutdown?: (code: number) => void }): Promise<RunningServer>`, with `RunningServer = { port: number; url: string; token: string; context: ServerContext; close(): Promise<void> }`. The default `uiDir` is `new URL("../ui/", import.meta.url)`.
  - `ServerContext = { store: Store; token: string; port: number; version: string; home: string; shutdown(code: number): void }`. Tasks 6–8 add fields to it.
  - `readServerFile(home): ServerInfo | null`, `writeServerFile(home, info)`, `clearServerFile(home, pid)` and `serverAlive(info): Promise<boolean>` (pid alive and `GET /api/health` answers), with `ServerInfo = { pid: number; port: number; version: string }`.
  - `readOrCreateToken(home): Promise<string>` creates the token with `wx` and mode 0600, and re-reads it on `EEXIST`.
  - `checkRequest(r: RequestFacts, server: { port: number; token: string }): Gate` is pure. `RequestFacts = { method: string; path: string; query: URLSearchParams; host?: string; cookie?: string; tokenHeader?: string; origin?: string; secFetchSite?: string; contentType?: string }` and `Gate = { kind: "ok" } | { kind: "set-cookie"; location: string } | { kind: "deny"; status: 401 | 403 | 415 | 421; reason: string }`.
  - `createRouter(): Router` with `get(pattern, handler)`, `post(pattern, handler)`, `stream(pattern, fn: (req: IncomingMessage, res: ServerResponse, ctx: ServerContext) => void)` and `match(method, path)`. `Handler = (req: { params: Record<string, string>; query: URLSearchParams; body: unknown }, ctx: ServerContext) => Promise<{ status: number; body: unknown }>`. `HttpError(status, message)` maps to that status, `InvalidInputError` to 400, and anything else to 500 `{ error: "internal error" }`, logged to stderr.
  - `registerApi(router)`; Tasks 6–8 add their route modules here.
  - `serveCommand(io, { port?: number }): Promise<number>` resolves 0 on SIGINT/SIGTERM and 75 after `/api/shutdown`. `ServerRunningError` prints `"already running on http://127.0.0.1:<port>/"` and exits 0.

- [ ] **Step 1: Failing tests.** `server-request.ts` is a helper that sends any headers through `node:http`, because fetch refuses to forge `Host`, `Origin` and `Sec-Fetch-*`.
  - `check-request.test.ts`, a table:
    - a foreign `Host` (`evil.test:<port>`, `127.0.0.1:1`) gives 421;
    - `GET /?token=<t>` gives `set-cookie` with location `/`, while a wrong token gives 401;
    - `/manifest.webmanifest`, `/sw.js`, `/favicon.svg` and `/icons/icon-192.png` are ok without a cookie;
    - an API request without the cookie gives 401;
    - a POST without `X-Grove-Token` gives 403;
    - a POST with `Origin: http://localhost:3000` gives 403;
    - a POST with `Sec-Fetch-Site: cross-site` gives 403;
    - a POST with `text/plain` gives 415;
    - a correct POST is ok.
  - `start-server.test.ts`, on port 0 with a temp home, using fetch:
    - `records pid, port and version in server.json and serves /api/health`.
    - `a second server with the same home refuses while the first runs`, throwing `ServerRunningError`.
    - `takes the next port when the asked one is busy`: occupy P with `net.createServer`; the server's port is P+1.
    - `GET /?token= sets an HttpOnly SameSite=Strict cookie and redirects without the token`: 302, `location: /`, and `set-cookie` contains `grove_token=`, `HttpOnly` and `SameSite=Strict`.
    - `/ with the cookie serves index.html with the token in a meta tag, a CSP and no-store`: the body contains `<meta name="grove-token" content="<token>">`; `content-security-policy` contains `script-src 'self'` and `frame-ancestors 'none'`.
    - `a rebound Host is 421 even with the cookie`.
    - `POST /api/shutdown needs the header, then closes the server and calls onShutdown(75)`.
    - `no response carries Access-Control-Allow-Origin`.
    - `a path that climbs out of the ui folder is 404`.
    - `close removes server.json`.
  - `serveCommand --port 0 exits 75 after /api/shutdown`.
- [ ] **Step 2:** Run the tests; they fail.
- [ ] **Step 3: Implement.**
  - Startup: acquire `<home>/server.lock` via `acquirePidLock`. `LockHeldError` becomes `ServerRunningError`, carrying the port from server.json. Then listen on `127.0.0.1`, trying `port` up to `port + 19` on `EADDRINUSE`, then write server.json.
  - Cookie: `grove_token=<t>; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`. Tokens are compared with `timingSafeEqual`.
  - Every response carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Cross-Origin-Resource-Policy: same-origin`, `Cross-Origin-Opener-Policy: same-origin` and `Cache-Control: no-store`. HTML also gets the CSP `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`.
  - Index: `%GROVE_TOKEN%` and `%GROVE_VERSION%` in `index.html` are replaced (HTML-escaped).
  - JSON bodies are limited to 64 KB (413 above that).
  - Routes: `GET /api/health` returns `{ version, pid }`. `POST /api/shutdown` returns 202, then closes and calls `onShutdown(75)`.
- [ ] **Step 4:** Run the tests; they pass. Commit `feat: local server with token cookie, Host check and single instance`.

### Task 6: Snapshot refactor and read API

**Files:**
- Create:
  - `src/core/snapshot/read-snapshot.ts`, `src/core/snapshot/still-unresolved.ts` and `src/core/snapshot/stranded-commits.ts` (the last two moved from `status.ts`)
  - `src/server/wire/wire.types.ts`, `src/server/wire/health-of.ts`, `src/server/wire/feature-id.ts`, `src/server/wire/to-repo-view.ts`, `src/server/wire/read-feature-detail.ts`, `src/server/wire/read-activity.ts`
  - `src/server/live/snapshots.ts`, `src/server/api/read-routes.ts`
- Modify: `src/cli/commands/status.ts` (now `readSnapshot` plus render; output unchanged), `src/server/server-context.types.ts` (add `snapshots`), `src/server/api/register-api.ts`
- Test: `test/core/snapshot/read-snapshot.test.ts`, `test/server/read-api.test.ts`

**Interfaces:**
- Produces:
  - `readSnapshot(cwd, store, now): Promise<Snapshot>`, with `Snapshot = { repoId: number; facts: RepoFacts; features: Feature[]; findings: Finding[]; journal: JournalEntry[]; added: JournalEntry[]; removals: Map<string, Verdict>; detachedOnly: Map<string, number | null>; readAt: number; elapsedMs: number }`. `added` is what `observe` returned on this call.
  - `healthOf(severity: Severity | "fine"): Health`, with `Health = "loses" | "action" | "review" | "idle" | "fine"`.
  - `featureId(repoId, name): string`, which is `<repoId>.<base64url(name)>`, and `parseFeatureId(id): { repoId: number; name: string } | null`.
- In `wire.types.ts` (the UI imports these as types):

```ts
type WireProject = { id: number; name: string; root: string; health: Health; worktrees: number; needsYou: number; pins: number; scannedAt: number | null; error: string | null };
type WireLevel = { branch: string; parent: string; depth: number; number: string | null; health: Health; state: string; findings: Finding[];
  worktree: { path: string; rel: string; dirty: number; operation: Operation | null; touchedAt: number | null } | null;
  upstream: { ahead: number; behind: number; gone: boolean } | null; behindTrunk: number; parentCommitsSinceFork: number;
  pinnedLost: number; merged: boolean; precious: number };
type WireFeature = { id: string; repoId: number; name: string; kind: FeatureKind; health: Health; levels: WireLevel[] };
type WireSandbox = { path: string; rel: string; head: string | null; touchedAt: number | null; health: Health; state: string };
type WireRepoView = { project: WireProject; trunk: string; lastFetchAt: number | null; features: WireFeature[]; detached: WireSandbox[]; findings: Finding[]; cleanupCount: number };
type WireRewrite = { branch: string; pinRef: string | null; at: number; lost: number; matchedByPatch: number; matchedByMeta: number; before: Lane; now: Lane | null };
type WireFeatureDetail = { feature: WireFeature; rewrites: WireRewrite[]; activity: ActivityItem[] };
type ActivityItem = { id: string; repoId: number; at: number; kind: ChangeKind | StoredActivity["kind"]; branch: string | null; title: string; detail: string; severity: Severity | null };
type NeedsYouItem = { repoId: number; repoName: string; featureId: string | null; finding: Finding };
```

- `toRepoView(project: WireProject, snapshot: Snapshot, pins: number): WireRepoView` is pure:
  - A level's `state` is the title of its worst finding, else `"In sync"`. `number` is the depth padded to two digits, for stacks only. Findings attach by branch, or by worktree path.
  - `cleanupCount` counts the merged worktrees whose verdict is ok or rescuable, plus the detached ones.
- `readFeatureDetail(snapshot, name, store): Promise<WireFeatureDetail | null>` builds lanes with `readLane` from `merge-base(oldTip, newTip)`: `before` marks the lost commits and pins the old tip.
- `readActivity(store, repoIds: number[], options: { branches?: ReadonlySet<string>; limit: number }): ActivityItem[]` merges journal entries with stored activity, newest first. The titles are `"History rewritten on <b>"`, `"Branch <b> deleted with N unique commits"`, `"<b> rebased"`, `"<b> amended"` and `"<b>: new commits"`.
- `createSnapshots(store, now?): Snapshots` returns `{ repos(): { id: number; commonDir: string; root: string }[]; get(repoId): Promise<Snapshot>; refresh(repoId): Promise<Snapshot>; cached(repoId): Snapshot | null; error(repoId): string | null }`.
  - `get` reuses a snapshot younger than 2 s, and refreshes are single-flight per repo.
  - `repos()` re-reads `store.repos()` when asked for an unknown id.
  - A failing refresh records `describeError(e) ?? "scan failed"` and rethrows.
- The routes:
  - `GET /api/projects` returns `WireProject[]`; a repo that fails to scan is listed with `error` set.
  - `GET /api/repos/:id/features` returns `WireRepoView`.
  - `GET /api/features/:id` returns `WireFeatureDetail`.
  - `GET /api/activity?repo=&feature=&limit=` returns `ActivityItem[]`; the limit defaults to 50 and is capped at 200.
  - `GET /api/pins?repo=` returns `PinEntry[]`.
  - `GET /api/needs-you` returns `NeedsYouItem[]`, worst first.
  - An unknown repo or feature is 404 `{ error }`.

- [ ] **Step 1: Failing tests.** The fixture is a temp repo with `makeStack` (3 levels), a single, a detached worktree, and a squash of level 01 between two `status` runs.
  - `readSnapshot returns what this call journaled in added` (the squash entry, once).
  - `GET /api/projects lists the repo as loses with its needs-you count`.
  - `GET /api/repos/:id/features groups the stack, the single and the sandbox`: the levels carry `number` `"01"`–`"03"` and `depth`; `detached.length === 1`; level 01 has `health: "loses"` and `state: "History rewritten"`.
  - `GET /api/features/:id for the squashed level has before and now lanes with 3 lost commits`.
  - `GET /api/activity lists the rewrite first, and ?feature= keeps only that feature's branches`.
  - `GET /api/needs-you puts loses-work first`.
  - `unknown repo or feature is 404 JSON`.
  - `a repo whose folder was deleted is listed with an error, not a 500`.
  - All of `test/cli/commands.test.ts` still passes, unchanged.
- [ ] **Step 2:** Run the tests; they fail.
- [ ] **Step 3: Implement** to the interfaces above. `startServer` opens the store at `<home>/grove.db` and sets `context.snapshots`.
- [ ] **Step 4:** Run the tests; they pass. Commit `feat: shared snapshot and the dashboard read API`.

### Task 7: Watcher, hub and SSE

**Files:**
- Create: `src/server/live/watch-repo.ts`, `src/server/live/digest-of.ts`, `src/server/live/hub.ts`, `src/server/live/server-event.types.ts`, `src/server/live/events-route.ts`
- Modify: `src/server/start-server.ts` (create the hub, close it on close), `src/server/server-context.types.ts` (add `hub`), `src/server/api/register-api.ts`
- Test: `test/server/watch-repo.test.ts`, `test/server/hub.test.ts`, `test/server/events.test.ts`

**Interfaces:**
- Consumes: `Snapshots`, `toRepoView`, `store.addActivity`.
- Produces:
  - `watchRepo(commonDir: string, onChange: () => void, options?: { debounceMs?: number; pollMs?: number }): { close(): void }`, with defaults of 300 ms and 30 000 ms. It runs `fs.watch(commonDir, { recursive: true })`, filtered to `^(refs/|packed-refs$|HEAD$|index$|logs/|worktrees/[^/]+/(HEAD|index)$|grove\.lock$)`, plus a poll. If the watcher errors, the poll keeps going alone.
  - `digestOf(view: WireRepoView): string` is a SHA-1 of the view with `scannedAt` left out.
  - `ServerEvent = { type: "hello"; version: string } | { type: "digest"; repoId: number; digest: string; at: number } | { type: "activity"; item: ActivityItem } | { type: "step"; runId: string; event: StepEvent } | { type: "receipt"; runId: string; receipt: Receipt }`.
  - `createHub(options: { snapshots: Snapshots; store: Store; debounceMs?: number; pollMs?: number }): Hub`, with `Hub = { scan(repoId?: number): Promise<void>; subscribe(listener: (e: ServerEvent) => void): () => void; publish(e: ServerEvent): void; close(): void }`.
    - It watches every `snapshots.repos()` at start, and any new id the read routes resolve.
    - A scan waits while `<commonDir>/grove.lock` exists; removing the lock is itself a watched change, which triggers the scan.
    - After each refresh it publishes a `digest` when the digest changed, and one `activity` per entry in `added`.
    - It diffs worktree paths against the previous snapshot, except on the first scan, and records `worktree-added`/`worktree-removed` activity.
    - A failed scan publishes and stores a `scan-error` activity once per distinct message.
  - `GET /events` (a router `stream`) sends `retry: 3000`, then `hello`, then every hub event as `event: <type>\ndata: <json>\n\n`, with a `: ping` comment every 25 s. Past 16 clients it returns 503.

- [ ] **Step 1: Failing tests**
  - `watch-repo.test.ts`, using `vi.waitFor`:
    - `a commit in a linked worktree fires one change after the debounce` (debounce 50 ms; count is 1 after 300 ms);
    - `a file written under objects/ fires nothing within 400 ms`;
    - `the poll fires with no fs events` (`pollMs: 50`);
    - `close stops both`.
  - `digestOf ignores scannedAt and changes when a finding appears`.
  - `hub.test.ts`, on a real repo:
    - `a squash publishes a digest and a "History rewritten on feat/model" activity`;
    - `a scan waits while grove.lock exists and runs once it is removed`;
    - `a worktree added outside grove becomes worktree-added activity`;
    - `a deleted repo folder publishes one scan-error and keeps the project listed`.
  - `events.test.ts`:
    - `GET /events streams hello, then a digest after a commit`: read the fetch body until `event: digest`;
    - `/events without the cookie is 401`.
- [ ] **Step 2:** Run the tests; they fail.
- [ ] **Step 3: Implement** to the interfaces above.
- [ ] **Step 4:** Run the tests; they pass. Commit `feat: watch repos and push digests and activity over SSE`.

### Task 8: Actions API

**Files:**
- Create: `src/server/actions/plan-cache.ts`, `src/server/actions/runs.ts`, `src/server/api/action-routes.ts`
- Modify: `src/server/server-context.types.ts` (add `plans` and `runs`), `src/server/api/register-api.ts`
- Test: `test/server/actions-api.test.ts`

**Interfaces:**
- Consumes: `prepareAction`, `runPrepared`, `Hub`, `appCommand`, `launchDetached`, `readConfig`.
- Produces:
  - `createPlanCache(options?: { ttlMs?: number; max?: number }): PlanCache`, with defaults of 600 000 ms and 50. `PlanCache = { put(repoId: number, prepared: Prepared): string; take(planId: string): { repoId: number; prepared: Prepared } | "expired" | "taken" }`; ids are 16 random bytes in base64url.
  - `createRuns(hub: Hub, store: Store): Runs`, with `Runs = { start(repoId: number, root: string, prepared: Prepared): string; get(runId: string): { plan: Plan; events: StepEvent[]; receipt: Receipt | null } | null }`.
  - The routes:
    - `POST /api/plans` `{ repo: number, action: ActionName, input: unknown }` returns 200 `{ planId, plan }`.
    - `POST /api/actions` `{ planId }` returns 202 `{ runId }`. An expired plan is 410 `"This preview expired; preview it again"`; a taken one is 409 `"This plan already ran"`.
    - `GET /api/runs/:id`.
    - `POST /api/scan` `{ repo?: number }` returns 202.
    - `POST /api/open` `{ repo: number, path: string, app: "editor" | "terminal" }` returns 200. The path must equal one of the repo's worktree paths (400 otherwise); a launch error is 500 with its message.

- [ ] **Step 1: Failing tests,** with a server on port 0 and a repo squashed between two snapshots.
  - `preview then run restores the squash; step events and the receipt arrive on /events`.
  - `the same plan cannot run twice` (409).
  - `a branch moved after the preview refuses the run and git is unchanged`.
  - `with the CLI holding the repo lock, the dashboard run is refused`: hold `withRepoLock` while posting; the receipt has `refused: true` and the title `"Another grove action is running in this repo"`.
  - `invalid input is 400 with the reason; an unknown repo is 404; an unknown action is 400`.
  - `a run's receipt is in /api/activity and a scan follows it`.
  - `open refuses a path that is not one of the repo's worktrees`.
- [ ] **Step 2:** Run the tests; they fail.
- [ ] **Step 3: Implement.**
  - `runs.start` calls `runPrepared` in the background, with `emit` publishing `step` events.
  - It publishes the `receipt` when done, then calls `hub.scan(repoId)`.
  - Its `ActionContext` is `{ root: snapshot.facts.root, store, now: Date.now }`.
- [ ] **Step 4:** Run the tests; they pass. Commit `feat: preview and run actions over the API`.

### Task 9: Frontend build, shell and read views

**Files:**
- Create:
  - Build and shell: `scripts/build-ui.mjs`, `ui/tsconfig.json`, `ui/index.html`, `ui/styles.css`, and `ui/public/fonts/` (woff2 files plus `OFL.txt`)
  - Core modules in `ui/src/`: `main.ts`, `html.ts`, `parse-route.ts`, `state.ts`, `api.ts`, `api.error.ts`, `live.ts`, `icons.ts`
  - Renderers in `ui/src/render/`: `async-states.ts`, `sidebar.ts`, `projects-view.ts`, `repo-view.ts`, `tree-gutter.ts`, `level-row.ts`, `detail-panel.ts`, `activity-list.ts`, `pins-view.ts`, `needs-you-view.ts`
- Modify: `package.json` (`pnpm add -D esbuild`; `build` becomes `tsc -p tsconfig.json && node scripts/build-ui.mjs`; `typecheck` adds `tsc -p ui/tsconfig.json`, with lib `ES2023, DOM, DOM.Iterable`). `tsconfig.test.json` stays as it is: the tested ui modules use no DOM API or build-time global, so tests compile them through their imports.
- Test: `test/ui/html.test.ts`, `test/ui/parse-route.test.ts`, `test/ui/state.test.ts`, `test/ui/api.test.ts`, `test/ui/level-row.test.ts`, `test/e2e/dashboard-smoke.test.ts`

**Interfaces:**
- Consumes: the wire types, `Plan`, `ServerEvent`, and `startServer` (smoke test only).
- Produces:
  - `html(strings, ...values): SafeHtml` escapes every value that is not already `SafeHtml`; `raw(text): SafeHtml`.
  - `parseRoute(hash): Route` and `routeHash(route): string`. `Route` covers `#/` (projects), `#/needs`, `#/activity`, `#/pins`, `#/r/<repo>` and `#/r/<repo>/f/<featureId>[/<branch, encoded>]`.
  - `type Load<T> = { status: "loading" } | { status: "ready"; data: T; stale: boolean } | { status: "error"; message: string; data: T | null }`.
  - `State = { route; projects: Load<WireProject[]>; repo: Load<WireRepoView> | null; feature: Load<WireFeatureDetail> | null; preview: Load<Plan> | null; activity: Load<ActivityItem[]> | null; pins: Load<PinEntry[]> | null; needs: Load<NeedsYouItem[]> | null; tab: "feature" | "health" | "activity"; needsOnly: boolean; live: "connecting" | "open" | "down"; lastEventAt: number | null; updateAvailable: boolean }`.
  - `reduce(state, action: UiAction): State` is pure. `UiAction` covers `route`, `loaded`, `failed` and `event` (a `ServerEvent`). Task 10 adds the dialog, palette and run actions.
  - `createApi(fetchImpl: typeof fetch, token: string): Api`, with `projects()`, `repo(id)`, `feature(id)`, `activity(q)`, `pins(repo)`, `needsYou()`, `plan(req)`, `run(planId)`, `runState(runId)`, `scan(repo?)` and `open(req)`. Each returns its typed promise, with one `as T` at the JSON boundary.
  - POST sends `X-Grove-Token` and `content-type: application/json`.
  - Errors are `ApiError { status, message }`: 401 gives `"Your session ended. Open the dashboard again with git grove ui."`; a network failure gives status 0 and `"git grove isn't running. Start it with git grove ui."`.
  - `connectLive(onEvent: (e: ServerEvent) => void, onState: (s: State["live"]) => void): () => void` wraps `EventSource("/events")`.
  - `levelRow(level: WireLevel, now: number): { pills: { text: string; pin: boolean }[]; num: string; when: string }` is pure.
  - `treeGutter(rows: { depth: number }[], index: number): SafeHtml` ports the mockup's `treeCell`.
  - Renderers take state slices and return `SafeHtml`.

- [ ] **Step 1: Failing tests**
  - `html.test.ts`:
    - ``html`<b>${"<img src=x onerror=alert(1)>"}</b>` `` renders `<b>&lt;img src=x onerror=alert(1)&gt;</b>`;
    - attribute values escape `"` as `&quot;` and `'` as `&#39;`;
    - `raw()` and nested `html` pass through unescaped.
  - `parse-route.test.ts`: a table round-tripping every route through `routeHash`; an unknown hash gives projects.
  - `state.test.ts`:
    - `a digest for the shown repo marks it stale; one for another repo leaves it`;
    - `a failed reload keeps the last data with the error`;
    - `hello with another version sets updateAvailable`;
    - `live goes down on error and open on hello`.
  - `api.test.ts`, with a fake fetch:
    - `POST sends X-Grove-Token and JSON`;
    - `a 401 becomes the sign-in message`;
    - `{ error } JSON surfaces as the message`;
    - `a rejected fetch becomes status 0 with "git grove isn't running"`.
  - `level-row.test.ts`:
    - `a rewritten level shows "3 commits pinned" as a pin pill and ↓ behind`;
    - `parent moved shows "+1 parent"`;
    - `a pushed level with nothing ahead shows "pushed"`;
    - `treeGutter draws an elbow at depth 2 and a through-line when a later sibling exists`.
  - `dashboard-smoke.test.ts`: in `beforeAll` (120 s), run `node scripts/build-ui.mjs --out <tmp>`, then `startServer({ port: 0, home: <tmp home>, uiDir: <tmp> })`.
    - `fetch("/?token=…", { redirect: "manual" })` is 302 with the cookie.
    - `/` with the cookie is 200 and contains the token meta and `/app.js`.
    - `/app.js` is 200 `text/javascript`, and `/styles.css` is 200.
    - `/api/projects` is 401 without the cookie and a 200 array with it.
    - `POST /api/scan` is 403 with the cookie but no header, and 202 with both.
- [ ] **Step 2:** Run the tests; they fail.
- [ ] **Step 3: Implement**, porting the mockup's structure, CSS and SVGs.
  - **Build:** `build-ui.mjs` runs esbuild, entry `{ app: "ui/src/main.ts" }` with `bundle`, `format: "esm"`, `target: "es2022"`, `minify`, linked `sourcemap` and `define: { __GROVE_VERSION__: <package version> }`. It then copies `index.html`, `styles.css` and `public/**` to the out dir, which defaults to `dist/ui`.
  - **Fonts:** download Atkinson Hyperlegible Next (wght 400–700) and Martian Mono (variable, wdth 75–112.5, wght 400–600) once, as latin woff2 from Google Fonts. Commit them with `OFL.txt` and declare them with `@font-face`, `font-display: swap`.
  - **Screens:**
    - The sidebar per the mockup: Needs you (count, hot when > 0), Activity, Pins (count), Repos with their health dot and worktree count, the current repo's features as sub-nav, and the footer `"Watching N repos, Xs ago"` with the pulse while live, else `"Not connected, retrying"`.
    - Projects: one row per repo, plus an activity strip of the latest 8 items across repos.
    - Repo: a bar with the crumb, tabs By feature / By health / Activity and Scan now. A filters row with a Needs-you toggle, the cleanup chip `"N worktrees safe to clean up"` (hidden at 0) and a summary. Groups: each stack, then Singles, then Detached (one row, `"N sandboxes, detached"`). A detail panel.
    - Detail by worst finding:
      - history-rewritten: banner, a "Nothing is lost yet" safe box, Bring back / Keep options, "What happened" lanes, and the two "Why grove calls it a loss" checks from `matchedByPatch`/`matchedByMeta`;
      - parent-moved, parent-merged and unsafe-merged-worktree: banner, option and checks from a lazily fetched preview (`api.plan`), headed `"checked Ns ago"`;
      - env-missing: banner and a Copy env files option;
      - anything else: the generic panel.
    - The detail panel ends with the feature's live activity list (`WireFeatureDetail.activity`).
    - Option buttons carry `data-action` for Task 10.
    - The sidebar footer's counts come from `WireProject[]`: its length, and the newest `scannedAt`.
  - **Every async surface** renders `loading()`, `empty(text)` or `failed(message, retry)`. The empty texts are `"No repos yet. Run git grove ui inside a repository."`, `"Nothing needs you"`, `"No activity yet"` and `"No pins"`.
  - `main.ts` reads the token meta, wires routing, effects (refetch the shown view on its digest, and projects at most once a second), event delegation and rendering into the three regions, coalesced with `requestAnimationFrame`.
- [ ] **Step 4:** Run `pnpm build && pnpm vitest run test/ui test/e2e`, then the whole suite; they pass. Commit `feat: dashboard shell and read views`.

### Task 10: Dialogs, runs and palette

**Files:**
- Create: `ui/src/render/plan-view.ts`, `ui/src/dialogs/dialog-specs.ts`, `ui/src/dialogs/dialog-host.ts`, `ui/src/palette/palette-items.ts`, `ui/src/palette/palette.ts`, `ui/src/toast.ts`, `ui/src/keys.ts`
- Modify: `ui/src/state.ts` (`dialog`, `palette` and `run` slices), `ui/src/main.ts`, `ui/src/render/repo-view.ts` (row and group actions)
- Test: `test/ui/plan-view.test.ts`, `test/ui/dialog-specs.test.ts`, `test/ui/palette-items.test.ts`

**Interfaces:**
- Consumes: `Api.plan`, `Api.run` and `Api.runState`, the `step`/`receipt` server events, and `Plan`/`Receipt`/`StepEvent`.
- Produces:
  - Plan rendering: `renderPlanBody(plan: Plan, values: FieldValues, spec: DialogSpec): SafeHtml`, `renderPlanFooter(plan: Plan | null, planning: boolean, error: string | null): SafeHtml`, `renderSteps(plan: Plan, events: StepEvent[]): SafeHtml` and `renderReceipt(receipt: Receipt): SafeHtml`.
  - `DialogSpec = { action: ActionName; fields: Field[]; initial(ctx: DialogContext): FieldValues; toInput(values: FieldValues): unknown }`, with `Field = { kind: "text" | "select" | "toggle" | "picks"; name: string; label: string; mono?: boolean; why?: string; options?: (ctx: DialogContext) => { value: string; label: string }[] }`, `FieldValues = Record<string, string | boolean | string[]>`, `DialogContext = { repo: WireRepoView; feature: WireFeature | null; level: WireLevel | null; targets: RestoreTarget[] | null; worktree: string | null }`, and `DIALOGS: Record<ActionName, DialogSpec>`.
  - `paletteItems(state: State, query: string): PaletteItem[]`, with `PaletteItem = { kind: "Actions" | "Go to"; text: string; hint: string | null; run: PaletteRun }` and `PaletteRun = { open: ActionName; ctx: DialogContext } | { route: Route } | { scan: number }`.

- [ ] **Step 1: Failing tests**
  - `plan-view.test.ts`:
    - `a plan with blockers renders a disabled confirm with the first blocker as the note`;
    - `the git commands disclosure lists every command, escaped`: a branch `a<b` renders as `a&lt;b`;
    - `checks render pass and fail with their why`;
    - `steps render pending, running, done with seconds, failed and skipped from events`;
    - `an undoable receipt renders Undo; a refused one renders its lines and "Preview again"`;
    - `folders render new entries marked new`.
  - `dialog-specs.test.ts`:
    - `new's input carries feature, branch, from and its three toggles, an empty branch left out`;
    - `restack's set-aside toggle defaults on`;
    - `add-level offers the feature's levels, deepest first`;
    - `cleanup's input is the picked paths, and the detached sandboxes toggle together`.
  - `palette-items.test.ts`:
    - `an empty query lists Actions before Go to`;
    - `"restack" finds the restack action for the stack that needs one`;
    - `a rewritten level adds "Bring back N commits on <branch>"`;
    - `no match gives []`.
- [ ] **Step 2:** Run the tests; they fail.
- [ ] **Step 3: Implement**, porting the mockup's dialog, steps, receipt, palette, toast and keyboard behaviour against the real API.
  - **Opening a dialog** previews at once. Any field change re-previews, debounced 250 ms; while it does, confirm is disabled and the note reads `"Checking…"`. A 400 shows its message in the note.
  - **Confirm** calls `api.run(planId)`. The body becomes `renderSteps`, driven by `step` events filtered by `runId`, with `api.runState` on reconnect. The footer reads `"You can close this; it keeps going."` and offers Hide.
  - **On the receipt:** Done; Undo when `receipt.undo` (it opens the restore dialog with `targets = receipt.undo`); a toast; a refetch.
  - **Row hover actions:** the quick action of the worst finding (restore, restack or rescue-remove), then editor and terminal (`api.open`, toasting the result or the error), then More, which opens the palette.
  - **Group actions:** Restack (hot when a level has parent-moved or parent-merged) and Add level on stacks; Clean up on Singles and Detached.
  - **Keys:** ⌘K/Ctrl-K opens the palette, N new feature, R restore or rescue-remove, S restack, A ack, j/k move the selection, Enter selects or confirms, Esc closes.
- [ ] **Step 4:** Run `pnpm build`, the tests and the whole suite; they pass. Commit `feat: run every action from the dashboard with live steps`.

### Task 11: `ui`, the login service, the PWA and the README

**Files:**
- Create:
  - Service: `src/core/service/service-host.ts`, `src/core/service/launchd-plist.ts`, `src/core/service/systemd-unit.ts`, `src/core/service/service-manager.ts`, `src/core/service/service-unsupported.error.ts`
  - CLI: `src/cli/commands/ui.ts`, `src/cli/commands/service.ts`, `src/cli/open-url.ts`, `src/cli/dashboard-url.ts`, `src/cli/compare-versions.ts`
  - PWA: `ui/src/sw.ts`, `ui/sw.tsconfig.json`, `ui/src/notify.ts`, `ui/public/manifest.webmanifest`, `ui/public/favicon.svg` (a copy of `docs/brand/mark.svg`), `ui/public/icons/icon-192.png`, `icon-512.png` and `icon-maskable-512.png`, `scripts/render-icons.sh`
- Modify:
  - CLI: `src/cli/main.ts` (routes `ui`, `service install|uninstall|status`, and no arguments meaning `ui`; usage), `src/cli/commands/status.ts` (a last line `Dashboard: http://127.0.0.1:<port>/` when server.json's pid is alive; not with `--json`)
  - Build and UI: `scripts/build-ui.mjs` (entry `sw`), `package.json` (typecheck adds `ui/sw.tsconfig.json`, lib `ES2023, WebWorker`), `ui/tsconfig.json` (exclude `src/sw.ts`), `ui/index.html` (manifest, theme colour, icons), `ui/src/main.ts` (register the service worker, notifications)
  - Docs: `README.md`, `scripts/smoke-install.sh`
- Test: `test/core/service/service-manager.test.ts`, `test/cli/ui-command.test.ts`, `test/ui/dashboard-url.test.ts`, and an extended `test/e2e/dashboard-smoke.test.ts`

**Interfaces:**
- Consumes: `startServer`, `readServerFile`, `serverAlive`, `readOrCreateToken`, `groveHome`, `featureId`, `groupFeatures`.
- Produces:
  - `ServiceHost = { platform: NodeJS.Platform; home: string; uid: number; path: string; run(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> }`, plus `realServiceHost(): ServiceHost`.
  - `launchdPlist(program: ServiceProgram): string` and `systemdUnit(program: ServiceProgram): string`, both pure, with `ServiceProgram = { node: string; bin: string; groveHome: string | null; path: string; logFile: string }`.
  - `createServiceManager(host: ServiceHost): ServiceManager` returns `{ support(): Promise<"launchd" | "systemd" | null>; install(program): Promise<{ wrote: string; removeWith: string }>; uninstall(): Promise<{ removed: string | null }>; start(): Promise<void>; status(): Promise<{ kind: "launchd" | "systemd" | null; installed: boolean; loaded: boolean }> }`.
    - `support` is `launchd` when on darwin and `launchctl` runs.
    - `support` is `systemd` when on linux and `systemctl --user show-environment` exits 0.
    - Otherwise `support` is null, and `install` throws `ServiceUnsupportedError`: `"no launchd or systemd user session here; run git grove serve yourself"`.
  - `dashboardUrl(port: number, token: string, target: { repoId: number; featureId: string | null } | null): string` gives `http://127.0.0.1:<port>/?token=<t>#/r/<repoId>/f/<featureId>`, `…#/r/<repoId>` or `…#/`.
  - `compareVersions(a, b): number` compares `x.y.z` versions.
  - `uiCommand(io, deps: UiDeps): Promise<number>`, with `UiDeps = { service: ServiceManager; openUrl(url: string): Promise<boolean>; serveForeground(): Promise<RunningServer>; bin: string; waitMs?: number }`.
  - `serviceCommand(io, sub: "install" | "uninstall" | "status", service: ServiceManager): Promise<number>`.

- [ ] **Step 1: Failing tests**
  - `service-manager.test.ts`, with a fake host that records commands in a temp home:
    - `on macOS, install writes the plist and bootstraps it`: the plist contains `<string>work.grove.server</string>`, `<string>serve</string>`, `RunAtLoad`, `SuccessfulExit` and `server.log`; the commands include `launchctl bootstrap gui/501 <plist>`.
    - `on Linux with a user systemd, install writes git-grove.service and enables it`: the unit contains `Restart=on-failure` and `WantedBy=default.target`; the commands include `systemctl --user enable --now git-grove.service`.
    - `with no launchd or systemd, support is null and install throws ServiceUnsupportedError naming git grove serve`, with no file written. Cases: linux with `show-environment` exiting 1, and darwin with no `launchctl`.
    - `uninstall unloads and removes only its own file`.
  - `ui-command.test.ts`, with a temp home, `openUrl` recorded and a fake service:
    - `with a server running, ui opens its URL at the current worktree's feature and installs nothing`: the URL ends with `#/r/<id>/f/<featureId>`.
    - `with no server and no service support, ui serves in the foreground and says so`: `serveForeground` is called, and the output contains `"foreground"`.
    - `with no server and an uninstalled service, ui installs it and prints the file and how to remove it`: the output contains the plist path and `git grove service uninstall`.
    - `a bin under an npx cache never installs the service`: given `/x/_npx/1/node_modules/git-grove/dist/cli/bin.js`, it serves in the foreground and the output contains `npm i -g git-grove`.
    - `a running server older than this CLI is asked to exit`: a server started with version `0.0.1` receives `/api/shutdown`.
    - `outside a repository ui opens the projects page`: the URL ends with `#/`.
  - `dashboard-url.test.ts`: the three URL forms; `compareVersions("0.1.0", "0.10.0") < 0`.
  - The smoke test grows `manifest, sw.js and icons load without the cookie`: 200 each, and the manifest's `display` is `"standalone"`.
- [ ] **Step 2:** Run the tests; they fail.
- [ ] **Step 3: Implement.**

  **`ui`:**
  1. Register the repo of `io.cwd` with `store.repoId`, and find the feature of the worktree containing cwd.
  2. Read server.json and check that it is alive; an older version gets `POST /api/shutdown`, followed by up to 5 s of waiting for a new pid.
  3. When nothing is alive and the bin is not under `/_npx/`: if the service is supported and not installed, install it and print `"Installed a login service: <file>\nRemove it with: git grove service uninstall"`. If it is installed but not running, `start()` it (`launchctl kickstart gui/<uid>/work.grove.server` or `systemctl --user start git-grove.service`). Then wait up to 5 s.
  4. If nothing is alive yet, `serveForeground()` and print `"Serving in the foreground; press Ctrl-C to stop"`.
  5. Open `dashboardUrl` with `open` (darwin) or `xdg-open` (linux). When that fails, or `GIT_GROVE_NO_OPEN=1` is set, print the URL.

  **Service files:**
  - The plist has `ProgramArguments` `[node, bin, serve]`, `RunAtLoad`, `KeepAlive { SuccessfulExit: false }`, stdout and stderr to `<home>/server.log`, and `EnvironmentVariables` with `PATH` and `GIT_GROVE_HOME` when set.
  - The unit has `ExecStart="<node>" "<bin>" serve`, `Restart=on-failure` and `Environment=PATH=…`.
  - Install boots out any old copy first; uninstall unloads before deleting.

  **Service worker:** a cache named `grove-<version>` pre-caches `/app.js`, `/styles.css`, `/favicon.svg`, the icons and the fonts, and activate deletes other `grove-*` caches. Never touch `/api/` or `/events`. A navigation to `/` is network first, falling back to the cached `/`; other GETs are cache first.

  **Manifest:** `{ "name": "git grove", "short_name": "grove", "id": "/", "start_url": "/", "scope": "/", "display": "standalone", "background_color": "#0B0F0E", "theme_color": "#0B0F0E" }`, with the three icons.

  **Icons:** `render-icons.sh` screenshots `mark.svg` with headless Chrome (`--headless=new --window-size=N,N --screenshot=…`). It renders the mark centred on `#0B0F0E` with a 22% rounded square for "any", and with a 20% safe zone, full-bleed, for maskable. Run it once and commit the PNGs.

  **Notifications:** a sidebar button reads `"Notify me"` while `Notification.permission === "default"`. Each `activity` event with severity `loses-work` raises `new Notification("git grove", { body: title, tag: id, icon: "/icons/icon-192.png" })`.

  **README:**
  - the dashboard: `git grove ui`, `serve`, `service install|uninstall|status`, what the service writes and how to remove it, and the security model in three lines;
  - the commands `new`, `add-level`, `restack`, `stack plan` and `rm --rescue`.

  **Smoke:** `smoke-install.sh` checks that `dist/ui/index.html` is in the installed package, runs `git grove serve --port 0` in the background, reads the port from server.json, expects `/api/projects` to return 401, and kills it.
- [ ] **Step 4:** Run `pnpm build`, `pnpm test` and `scripts/smoke-install.sh`; they pass. Commit `feat: git grove ui, a login service and an installable dashboard`.

---

Not in this slice: `rm --force` (6.5), `stack adopt`/`list`/`show` (6.4), `add`/`remove-repo` and `setup` (6.8, 6.10), pushing after a restack, `log`, the guard (6.6) and its activity and avatars, GitHub data (6.9) and `git grove demo` (6.11).
