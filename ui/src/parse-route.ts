/** What is selected in a repository: a feature (and one of its branches), a deleted branch, or the detached sandboxes. */
export type RowRef =
  | { kind: "feature"; feature: string; branch: string | null }
  | { kind: "deleted"; branch: string }
  | { kind: "detached" };

export type Route =
  | { view: "projects" }
  | { view: "needs" }
  | { view: "activity" }
  | { view: "pins" }
  | { view: "repo"; repo: number; pick: RowRef | null };

const PROJECTS: Route = { view: "projects" };

function decoded(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function repoRoute(repo: number, rest: string[]): Route {
  const [kind, first, second, ...extra] = rest;
  if (kind === undefined) return { view: "repo", repo, pick: null };
  if (kind === "detached" && first === undefined) return { view: "repo", repo, pick: { kind: "detached" } };
  if (kind === "deleted" && first !== undefined && second === undefined) {
    const branch = decoded(first);
    return branch === null || branch === "" ? PROJECTS : { view: "repo", repo, pick: { kind: "deleted", branch } };
  }
  if (kind === "f" && first !== undefined && extra.length === 0) {
    const feature = decoded(first);
    const branch = second === undefined ? null : decoded(second);
    if (feature === null || feature === "" || branch === "" || (second !== undefined && branch === null)) return PROJECTS;
    return { view: "repo", repo, pick: { kind: "feature", feature, branch } };
  }
  return PROJECTS;
}

/**
 * The route a location hash names: `#/` (projects), `#/needs`, `#/activity`, `#/pins`, `#/r/<repo>`,
 * `#/r/<repo>/f/<featureId>[/<branch>]`, `#/r/<repo>/deleted/<branch>` or `#/r/<repo>/detached`, branches
 * percent-encoded. Anything else is projects.
 */
export function parseRoute(hash: string): Route {
  if (!hash.startsWith("#/")) return PROJECTS;
  const [head, ...rest] = hash.slice(2).split("/");
  if (rest.length === 0 && (head === "needs" || head === "activity" || head === "pins")) return { view: head };
  if (head === "r" && rest[0] !== undefined && /^[1-9]\d{0,14}$/.test(rest[0])) return repoRoute(Number(rest[0]), rest.slice(1));
  return PROJECTS;
}

/** The hash `parseRoute` reads back as `route`. */
export function routeHash(route: Route): string {
  if (route.view !== "repo") return route.view === "projects" ? "#/" : `#/${route.view}`;
  const base = `#/r/${route.repo}`;
  const { pick } = route;
  if (pick === null) return base;
  if (pick.kind === "detached") return `${base}/detached`;
  if (pick.kind === "deleted") return `${base}/deleted/${encodeURIComponent(pick.branch)}`;
  return `${base}/f/${encodeURIComponent(pick.feature)}${pick.branch === null ? "" : `/${encodeURIComponent(pick.branch)}`}`;
}
