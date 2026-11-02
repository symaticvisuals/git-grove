import type { Plan } from "../../src/core/actions/plan.types.js";
import type { GuardState } from "../../src/core/guard-install/guard-install.types.js";
import type { PinEntry } from "../../src/core/runner/list-pins.js";
import type { ActivityItem, NeedsYouItem, WireFeatureDetail, WireProject, WireRepoView } from "../../src/server/wire/wire.types.js";
import { activityQuery } from "./activity-query.js";
import type { Api } from "./api.js";
import { effectivePick } from "./effective-pick.js";
import { findLevel } from "./find-level.js";
import { previewRequest } from "./preview-request.js";
import type { SliceName } from "./slice-names.js";
import type { State } from "./state.js";

export type RepoPins = { repoId: number; name: string; pins: PinEntry[] };

export type SliceResult =
  | { slice: "projects"; data: WireProject[] }
  | { slice: "repo"; data: WireRepoView }
  | { slice: "feature"; data: WireFeatureDetail }
  | { slice: "preview"; data: Plan }
  | { slice: "activity"; data: ActivityItem[] }
  | { slice: "pins"; data: RepoPins[] }
  | { slice: "needs"; data: NeedsYouItem[] }
  | { slice: "guard"; data: GuardState };

/** How to load one slice; `key` names what it loads, so a reply for anything else is dropped. */
export type SliceRequest = { key: string; fetch(api: Api): Promise<SliceResult> };

export type SliceRequests = Record<SliceName, SliceRequest | null>;

async function allPins(api: Api): Promise<RepoPins[]> {
  const projects = await api.projects();
  return Promise.all(projects.map(async (project) => ({ repoId: project.id, name: project.name, pins: await api.pins(project.id) })));
}

/**
 * What the current route needs loaded, slice by slice, or null for a slice it does not show. The feature and the
 * preview follow the selected level (`effectivePick`), so they change as the repo's view loads. The agent guard's
 * state is shown on every route.
 */
export function sliceRequests(state: State): SliceRequests {
  const { route } = state;
  const repoId = route.view === "repo" ? route.repo : null;
  const loaded = state.repo !== null && state.repo.status !== "loading" ? state.repo.data : null;
  const repo = loaded !== null && loaded.project.id === repoId ? loaded : null;
  const pick = effectivePick(route, repo);
  const featureId = pick?.kind === "feature" ? pick.feature : null;
  const found = repo !== null && pick?.kind === "feature" && pick.branch !== null ? findLevel(repo, pick.feature, pick.branch) : null;
  const preview = repoId !== null && found !== null ? previewRequest(repoId, found.feature, found.level) : null;
  const activity = activityQuery(state);
  return {
    projects: { key: "projects", fetch: async (api) => ({ slice: "projects", data: await api.projects() }) },
    repo: repoId === null ? null : { key: `repo:${repoId}`, fetch: async (api) => ({ slice: "repo", data: await api.repo(repoId) }) },
    feature: featureId === null ? null : { key: `feature:${featureId}`, fetch: async (api) => ({ slice: "feature", data: await api.feature(featureId) }) },
    preview:
      preview === null ? null : { key: `preview:${JSON.stringify(preview)}`, fetch: async (api) => ({ slice: "preview", data: (await api.plan(preview)).plan }) },
    activity:
      activity === null
        ? null
        : { key: `activity:${activity.repo ?? "all"}:${activity.limit}`, fetch: async (api) => ({ slice: "activity", data: await api.activity(activity) }) },
    pins: route.view === "pins" ? { key: "pins", fetch: async (api) => ({ slice: "pins", data: await allPins(api) }) } : null,
    needs: route.view === "needs" ? { key: "needs", fetch: async (api) => ({ slice: "needs", data: await api.needsYou() }) } : null,
    guard: { key: "guard", fetch: async (api) => ({ slice: "guard", data: await api.guard() }) },
  };
}
