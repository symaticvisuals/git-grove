import { InvalidInputError } from "../../core/actions/invalid-input.error.js";
import { unlessGitFails } from "../../core/git/unless-git-fails.js";
import { listPins, type PinEntry } from "../../core/runner/list-pins.js";
import { SEVERITY_RANK } from "../../core/rules/rule.types.js";
import { HttpError } from "../http/http.error.js";
import type { Router } from "../http/router.js";
import { parseFeatureId } from "../wire/parse-feature-id.js";
import { readActivity } from "../wire/read-activity.js";
import { readFeatureDetail } from "../wire/read-feature-detail.js";
import { readProject } from "../wire/read-project.js";
import { toNeedsYouItems } from "../wire/to-needs-you-items.js";
import { toRepoView } from "../wire/to-repo-view.js";
import type { NeedsYouItem } from "../wire/wire.types.js";
import { findRepo } from "./find-repo.js";
import { readSnapshotOrFail } from "./read-snapshot-or-fail.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function limitOf(raw: string | null): number {
  if (raw === null) return DEFAULT_LIMIT;
  if (!/^\d+$/.test(raw) || Number(raw) < 1) throw new InvalidInputError("limit must be a positive whole number");
  return Math.min(Number(raw), MAX_LIMIT);
}

/**
 * Adds the dashboard's read routes: `GET /api/projects`, `/api/repos/:id/features`, `/api/features/:id`,
 * `/api/activity?repo=&feature=&limit=` (limit 50, at most 200), `/api/pins?repo=` and `/api/needs-you`.
 * An unknown repository or feature is a 404 `{ error }`; a repository that cannot be scanned is a 503.
 */
export function registerReadRoutes(router: Router): void {
  router.get("/api/projects", async (_req, ctx) => ({
    status: 200,
    body: await Promise.all(ctx.snapshots.repos().map(async (repo) => (await readProject(ctx.snapshots, repo)).project)),
  }));

  router.get("/api/repos/:id/features", async (req, ctx) => {
    const repo = findRepo(ctx, req.params["id"] ?? "");
    const { project, snapshot } = await readProject(ctx.snapshots, repo);
    if (snapshot === null) throw new HttpError(503, project.error ?? "scan failed");
    return { status: 200, body: toRepoView(project, snapshot, project.pins) };
  });

  router.get("/api/features/:id", async (req, ctx) => {
    const id = parseFeatureId(req.params["id"] ?? "");
    if (id === null) throw new HttpError(404, "unknown feature");
    const repo = findRepo(ctx, String(id.repoId));
    const detail = await readFeatureDetail(await readSnapshotOrFail(ctx, repo.id), id.name, ctx.store);
    if (detail === null) throw new HttpError(404, "unknown feature");
    return { status: 200, body: detail };
  });

  router.get("/api/activity", async (req, ctx) => {
    const limit = limitOf(req.query.get("limit"));
    const featureParam = req.query.get("feature");
    const repoParam = req.query.get("repo");
    if (featureParam !== null && repoParam !== null) throw new InvalidInputError("give either feature or repo, not both");
    if (featureParam !== null) {
      const id = parseFeatureId(featureParam);
      if (id === null) throw new HttpError(404, "unknown feature");
      const repo = findRepo(ctx, String(id.repoId));
      const feature = (await readSnapshotOrFail(ctx, repo.id)).features.find((candidate) => candidate.name === id.name);
      if (feature === undefined) throw new HttpError(404, "unknown feature");
      const branches = new Set(feature.levels.map((level) => level.branch));
      return { status: 200, body: readActivity(ctx.store, [repo.id], { branches, limit }) };
    }
    const repoIds = repoParam === null ? ctx.snapshots.repos().map((repo) => repo.id) : [findRepo(ctx, repoParam).id];
    return { status: 200, body: readActivity(ctx.store, repoIds, { limit }) };
  });

  router.get("/api/pins", async (req, ctx) => {
    const repoParam = req.query.get("repo");
    const repos = repoParam === null ? ctx.snapshots.repos() : [findRepo(ctx, repoParam)];
    const pins: PinEntry[] = [];
    for (const repo of repos) pins.push(...(await unlessGitFails(listPins(repo.root), [])));
    return { status: 200, body: pins };
  });

  router.get("/api/needs-you", async (_req, ctx) => {
    const items: NeedsYouItem[] = [];
    for (const repo of ctx.snapshots.repos()) {
      const snapshot = await ctx.snapshots.get(repo.id).catch(() => null);
      if (snapshot !== null) items.push(...toNeedsYouItems(repo, snapshot));
    }
    items.sort((a, b) => SEVERITY_RANK[a.finding.severity] - SEVERITY_RANK[b.finding.severity]);
    return { status: 200, body: items };
  });
}
