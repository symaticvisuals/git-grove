import type { State } from "./state.js";

/** The activity the current view lists: the latest 8 across repos on projects, 50 on Activity, 50 of the repo on its Activity tab. */
export function activityQuery(state: Pick<State, "route" | "tab">): { repo?: number; limit: number } | null {
  const { route } = state;
  if (route.view === "projects") return { limit: 8 };
  if (route.view === "activity") return { limit: 50 };
  if (route.view === "repo" && state.tab === "activity") return { repo: route.repo, limit: 50 };
  return null;
}
