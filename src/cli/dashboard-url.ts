/** The part of the dashboard to open: a repository and, inside it, a feature. */
export type DashboardTarget = { repoId: number; featureId: string | null };

/**
 * The address `git grove ui` opens: `http://127.0.0.1:<port>/#token=<token>&route=<route>`, the route encoded, naming
 * the feature (`/r/<repoId>/f/<featureId>`), the repository (`/r/<repoId>`) or the projects page (`/`). The token
 * rides in the fragment, which the browser never sends to any server.
 */
export function dashboardUrl(port: number, token: string, target: DashboardTarget | null): string {
  const route = target === null ? "/" : target.featureId === null ? `/r/${target.repoId}` : `/r/${target.repoId}/f/${target.featureId}`;
  return `http://127.0.0.1:${port}/#token=${token}&route=${encodeURIComponent(route)}`;
}
