import type { WireFeature, WireLevel, WireRepoView } from "../../../src/server/wire/wire.types.js";
import type { DialogContext } from "./dialog-specs.js";

/** What an action button names, from its `data-` attributes: a feature id, a branch, a pin ref, a worktree path. */
export type ActionData = { feature?: string | undefined; branch?: string | undefined; pin?: string | undefined; path?: string | undefined };

type Found = { feature: WireFeature; level: WireLevel } | null;

function among(features: readonly WireFeature[], match: (level: WireLevel) => boolean): Found {
  for (const feature of features) {
    const level = feature.levels.find(match);
    if (level !== undefined) return { feature, level };
  }
  return null;
}

function levelFor(repo: WireRepoView, named: WireFeature | undefined, { branch, path }: ActionData): Found {
  const features = named === undefined ? repo.features : [named];
  if (branch !== undefined) return among(features, (level) => level.branch === branch);
  if (path !== undefined) return among(features, (level) => level.worktree?.path === path);
  return null;
}

/**
 * The dialog context for an action on `repo` that names `data`. The level is the one on `data.branch`, else the one
 * whose worktree is `data.path`, looked for in `data.feature` when it names one; the feature is `data.feature`, else
 * that level's. A branch the repo has no level for, such as a deleted one, is kept as the branch and the restore target.
 */
export function dialogContext(repo: WireRepoView, data: ActionData): DialogContext {
  const named = data.feature === undefined ? undefined : repo.features.find((feature) => feature.id === data.feature);
  const found = levelFor(repo, named, data);
  const { branch, pin } = data;
  return {
    repo,
    feature: named ?? found?.feature ?? null,
    level: found?.level ?? null,
    branch: branch ?? found?.level.branch ?? null,
    targets: branch === undefined ? null : [pin === undefined || pin === "" ? { branch } : { branch, pinRef: pin }],
    worktree: data.path ?? found?.level.worktree?.path ?? null,
  };
}
