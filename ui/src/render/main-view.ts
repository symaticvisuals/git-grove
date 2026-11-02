import { effectivePick } from "../effective-pick.js";
import { html, type SafeHtml } from "../html.js";
import type { State } from "../state.js";
import { activityList } from "./activity-list.js";
import { loadView } from "./load-view.js";
import { needsYouView } from "./needs-you-view.js";
import { notices } from "./notices.js";
import { pinsView } from "./pins-view.js";
import { projectsView } from "./projects-view.js";
import { repoView } from "./repo-view.js";
import { signedOut } from "./signed-out.js";
import { viewBar } from "./view-bar.js";

/** The main region for the current route: the notices, then that route's bar and list. */
export function mainView(state: State, now: number): SafeHtml {
  if (state.signedOut) return signedOut();
  const { route } = state;
  const top = notices(state);
  switch (route.view) {
    case "projects":
      return html`${top}${projectsView(state.projects, state.activity, now)}`;
    case "needs":
      return html`${top}${needsYouView(state.needs)}`;
    case "pins":
      return html`${top}${pinsView(state.pins, now)}`;
    case "activity": {
      const names = new Map((state.projects.status === "loading" ? [] : (state.projects.data ?? [])).map((project) => [project.id, project.name]));
      return html`${top}${viewBar(html`<b>Activity</b>`)}<div class="list">${loadView(state.activity, "activity", (items) => activityList(items, now, names))}</div>`;
    }
    case "repo": {
      const view = state.repo !== null && state.repo.status !== "loading" ? state.repo.data : null;
      const pick = effectivePick(route, view !== null && view.project.id === route.repo ? view : null);
      return html`${top}${repoView({ repoId: route.repo, repo: state.repo, activity: state.activity, tab: state.tab, needsOnly: state.needsOnly, closed: state.closed, pick, now })}`;
    }
  }
}
