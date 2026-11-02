import type { Health } from "../../../src/server/wire/health-of.js";
import type { NeedsYouItem } from "../../../src/server/wire/wire.types.js";
import { html, type SafeHtml } from "../html.js";
import { ICONS } from "../icons.js";
import { type Route, routeHash } from "../parse-route.js";
import { sentence } from "../sentence.js";
import type { Load } from "../state.js";
import { empty } from "./empty.js";
import { loadView } from "./load-view.js";
import { viewBar } from "./view-bar.js";

function routeOf(item: NeedsYouItem): Route {
  if (item.orphan !== null) return { view: "repo", repo: item.repoId, pick: { kind: "deleted", branch: item.orphan } };
  if (item.featureId === null) return { view: "repo", repo: item.repoId, pick: null };
  const branch = item.finding.subject.kind === "branch" ? item.finding.subject.id : null;
  return { view: "repo", repo: item.repoId, pick: { kind: "feature", feature: item.featureId, branch } };
}

/** Every finding across repos that needs the user, worst first; each opens its detail. */
export function needsYouView(needs: Load<NeedsYouItem[]> | null): SafeHtml {
  const list = loadView(needs, "needs", (items) => {
    if (items.length === 0) return empty("Nothing needs you");
    return html`${items.map((item) => {
      const health: Health = item.finding.severity === "loses-work" ? "loses" : "action";
      return html`<div class="row nrow h-${health}" role="button" tabindex="0" data-href="${routeHash(routeOf(item))}"><span class="tcell">${ICONS.health(health)}</span><span class="br"><b>${item.finding.title}</b><span class="mono subject">${item.finding.subject.id}</span><span class="why">${sentence(item.finding.detail)}</span></span><span class="when">${item.repoName}</span></div>`;
    })}`;
  });
  return html`${viewBar(html`<b>Needs you</b>`)}<div class="list">${list}</div>`;
}
