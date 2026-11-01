import type { Plan, StepEvent } from "../core/actions/plan.types.js";

const MARKS: Record<StepEvent["state"], string> = { running: "…", done: "✓", failed: "✖", skipped: "-" };

/** Renders one step event as a line: the step's mark and title, then its detail and time once it has them. */
export function renderStepEvent(plan: Plan, event: StepEvent): string {
  const title = plan.steps[event.index]?.title ?? `step ${event.index + 1}`;
  if (event.state === "running") return `  ${MARKS.running} ${title}\n`;
  const detail = event.state === "skipped" ? `skipped: ${event.detail}` : event.detail;
  const time = event.ms === null ? "" : ` (${event.ms} ms)`;
  return `  ${MARKS[event.state]} ${title}${detail ? `  ${detail}` : ""}${time}\n`;
}
