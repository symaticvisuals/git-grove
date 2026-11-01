import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeRepo, type TestRepo } from "./make-repo.js";
import { makeStack } from "./make-stack.js";

export type SquashedFixture = {
  repo: TestRepo;
  /** Level 01's worktree; `squash` rewrites its three commits into one. */
  level1: string;
  detached: string;
  squash: () => Promise<void>;
};

const LEVELS = [
  { branch: "feat/coupons-model", parent: "main", file: "model.ts" },
  { branch: "feat/coupons-ui", parent: "feat/coupons-model", file: "ui.ts" },
  { branch: "feat/coupons-email", parent: "feat/coupons-ui", file: "email.ts" },
];

/**
 * A repository with a 3-level stack (level 01 holds three commits), a single branch with a worktree and a detached
 * worktree. `squash` folds level 01 into one commit.
 */
export async function squashedFixture(): Promise<SquashedFixture> {
  const repo = await makeRepo();
  await repo.git("config", "stack.trunk", "main");
  await repo.commit(".gitignore", ".worktrees/\n", "ignore");
  const fork = await repo.commit("base.txt", "base\n", "base");
  const paths = await makeStack(repo, { feature: "checkout coupons", levels: LEVELS });
  const level1 = paths["feat/coupons-model"] ?? "";
  for (const name of ["two.ts", "three.ts"]) {
    await writeFile(join(level1, name), name);
    await repo.git("-C", level1, "add", name);
    await repo.git("-C", level1, "commit", "-m", `add ${name}`);
  }
  await repo.worktree(join(repo.path, ".worktrees", "single"), "fix/invoice-rounding");
  const detached = join(repo.path, ".worktrees", "sandbox");
  await repo.git("worktree", "add", "--detach", detached, "main");
  return {
    repo,
    level1,
    detached,
    async squash() {
      await repo.git("-C", level1, "reset", "--soft", fork);
      await repo.git("-C", level1, "commit", "-m", "squashed");
    },
  };
}
