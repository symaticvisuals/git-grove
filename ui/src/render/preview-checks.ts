import type { Plan } from "../../../src/core/actions/plan.types.js";
import { html, type SafeHtml } from "../html.js";
import type { Load } from "../state.js";
import { checkRow } from "./check-row.js";
import { loadView } from "./load-view.js";
import { timeAgo } from "./time-ago.js";

/** A section of the checks a previewed plan made, headed with how long ago it read them; what blocks it fails first. */
export function previewChecks(heading: string, preview: Load<Plan> | null, now: number): SafeHtml {
  const plan = preview === null || preview.status === "loading" ? null : preview.data;
  const when = plan === null ? "" : html`<span class="t">checked ${timeAgo(plan.readAt, now, "long")}</span>`;
  const body = loadView(preview, "preview", (data) => {
    const blockers = data.blockers.map((text) => checkRow({ ok: false, text, why: null }));
    return html`<div class="checks">${blockers}${data.checks.map((check) => checkRow(check))}</div>`;
  });
  return html`<div class="d-sec"><div class="h3">${heading} ${when}</div>${body}</div>`;
}
