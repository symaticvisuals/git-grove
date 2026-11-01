import type { Rule } from "./rule.types.js";
import { branchDeleted } from "./v1/branch-deleted.js";
import { envMissing } from "./v1/env-missing.js";
import { historyRewritten } from "./v1/history-rewritten.js";
import { idle } from "./v1/idle.js";
import { nestedWorktree } from "./v1/nested-worktree.js";
import { operationInProgress } from "./v1/operation-in-progress.js";
import { parentMerged } from "./v1/parent-merged.js";
import { parentMoved } from "./v1/parent-moved.js";
import { prunable } from "./v1/prunable.js";
import { unsafeMergedWorktree } from "./v1/unsafe-merged-worktree.js";

export const RULES: Rule[] = [
  historyRewritten,
  branchDeleted,
  unsafeMergedWorktree,
  nestedWorktree,
  operationInProgress,
  parentMerged,
  parentMoved,
  envMissing,
  prunable,
  idle,
];
