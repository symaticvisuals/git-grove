import type { Plan, StepEvent } from "../../../src/core/actions/plan.types.js";
import { html, type SafeHtml } from "../html.js";
import { ICONS } from "../icons.js";

const RANK: Record<StepEvent["state"], number> = { running: 1, done: 2, failed: 2, skipped: 2 };

function latest(events: readonly StepEvent[], index: number): StepEvent | null {
  let found: StepEvent | null = null;
  for (const event of events) if (event.index === index && (found === null || RANK[event.state] >= RANK[found.state])) found = event;
  return found;
}

function seconds(ms: number | null): string {
  return ms === null ? "" : `${(ms / 1000).toFixed(1)} s`;
}

function item(step: Plan["steps"][number], event: StepEvent | null): SafeHtml {
  const detail = event !== null && event.detail !== "" ? event.detail : step.detail;
  const body = html`<div>${step.title}${detail === "" ? "" : html`<div class="sub">${detail}</div>`}</div>`;
  switch (event?.state) {
    case undefined:
      return html`<li class="step pending"><span class="pend" role="img" aria-label="waiting"></span>${body}<span class="dur"></span></li>`;
    case "running":
      return html`<li class="step"><span class="spin" role="img" aria-label="running"></span>${body}<span class="dur"></span></li>`;
    case "done":
      return html`<li class="step">${ICONS.ok}${body}<span class="dur">${seconds(event.ms)}</span></li>`;
    case "failed":
      return html`<li class="step bad">${ICONS.no}${body}<span class="dur">${seconds(event.ms)}</span></li>`;
    case "skipped":
      return html`<li class="step skipped">${ICONS.dot}${body}<span class="dur"></span></li>`;
  }
}

function progress(states: (StepEvent | null)[]): string {
  const finished = states.filter((event) => event !== null && event.state !== "running").length;
  if (states.length > 0 && finished === states.length) return states.some((event) => event?.state === "failed") ? "stopped" : "done";
  return `${Math.min(finished + 1, states.length)} of ${states.length}`;
}

/**
 * A run's steps from its events: pending, running with a spinner, done with its time in seconds, failed, or skipped
 * with why. Each step shows its last state whatever order its events came in, and the detail its last event gave.
 */
export function renderSteps(plan: Plan, events: readonly StepEvent[]): SafeHtml {
  const states = plan.steps.map((_, index) => latest(events, index));
  return html`<section><div class="h3">Steps <span class="t">${progress(states)}</span></div><ul class="steps">${plan.steps.map((step, index) => item(step, states[index] ?? null))}</ul></section>`;
}
