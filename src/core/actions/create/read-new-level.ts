import { existsSync } from "node:fs";
import type { RepoFacts, Sha } from "../../facts/facts.types.js";
import { listMainEnvFiles } from "../../facts/list-main-env-files.js";
import { runGit } from "../../git/run-git.js";
import { displayPath } from "../display-path.js";
import { detectInstall } from "./detect-install.js";
import { levelFolder } from "./level-folder.js";
import type { NewLevel } from "./new-level.types.js";

export type NewLevelSpec = {
  feature: string;
  branch: string;
  parent: string;
  forkPoint: Sha;
  depth: number;
  recordFeature: boolean;
  env: boolean;
  install: boolean;
  open: boolean;
};

async function isIgnored(root: string, folder: string): Promise<boolean> {
  const relative = displayPath(root, folder);
  return (await runGit(["check-ignore", "-q", "--no-index", `${relative}/`], { cwd: root, allowFailure: true })).code === 0;
}

async function isBranchName(root: string, branch: string): Promise<boolean> {
  return (await runGit(["check-ref-format", "--branch", branch], { cwd: root, allowFailure: true })).code === 0;
}

/**
 * Reads what creating `spec` needs: the folder, the main worktree's env files, the install command, and whether
 * `.worktrees/` is ignored. The blockers say what already exists or is not allowed: a taken branch name, a taken
 * folder, or a name git rejects.
 */
export async function readNewLevel(facts: RepoFacts, spec: NewLevelSpec): Promise<{ level: NewLevel; blockers: string[] }> {
  const { root } = facts;
  const folder = levelFolder(root, spec.feature, spec.depth, spec.branch);
  const blockers: string[] = [];
  if (!(await isBranchName(root, spec.branch))) blockers.push(`${spec.branch} is not a valid branch name`);
  else if (facts.branches.some((branch) => branch.name === spec.branch)) blockers.push(`Branch ${spec.branch} already exists`);
  if (existsSync(folder)) blockers.push(`${displayPath(root, folder)} already exists`);

  const install = detectInstall(root);
  const level: NewLevel = {
    feature: spec.feature,
    branch: spec.branch,
    parent: spec.parent,
    forkPoint: spec.forkPoint,
    depth: spec.depth,
    folder,
    mainPath: root,
    recordFeature: spec.recordFeature,
    ignoreWorktrees: !(await isIgnored(root, folder)),
    envFiles: spec.env ? (await listMainEnvFiles(facts)).sort() : [],
    install: spec.install ? install : null,
    installHint: !spec.install && install !== null ? install.label : null,
    open: spec.open,
  };
  return { level, blockers };
}
