import type { StepEvent } from "../../src/core/actions/plan.types.js";
import { MESSAGES } from "./messages.js";
import type { State, UiAction } from "./state.js";

function finished(events: readonly StepEvent[]): Map<number, "done" | "failed"> {
  const ends = new Map<number, "done" | "failed">();
  for (const event of events) if ((event.state === "done" || event.state === "failed") && !ends.has(event.index)) ends.set(event.index, event.state);
  return ends;
}

function stepNews(before: State, after: State): string | null {
  const run = after.run;
  if (run === null || run.runId === null || before.run?.runId !== run.runId || before.run.events === run.events) return null;
  const was = finished(before.run.events);
  const now = finished(run.events);
  const total = run.plan.steps.length;
  const fresh = [...now].filter(([index]) => !was.has(index)).sort(([a], [b]) => a - b);
  if (fresh.length === 0) return null;
  return fresh.map(([index, how]) => `Step ${index + 1} of ${total} ${how}: ${run.plan.steps[index]?.title ?? ""}`).join(". ");
}

/**
 * What a screen reader should hear after `action` took `before` to `after`, or null: each step of the current run
 * once, when it first finishes or fails, a new alert that needs the user, a load that newly failed (not one that
 * fails again with the same message), the connection dropping, an update, or the page signing out. Repaints
 * announce nothing.
 */
export function announcement(before: State, after: State, action: UiAction): string | null {
  const steps = stepNews(before, after);
  if (steps !== null) return steps;
  if (action.type === "event" && action.event.type === "activity") {
    const { item } = action.event;
    return item.severity === "loses-work" || item.severity === "needs-action" ? `${item.title}.` : null;
  }
  if (!before.signedOut && after.signedOut) return MESSAGES.signedOut;
  if (!before.liveDropped && after.liveDropped) return after.liveProblem === "busy" ? MESSAGES.tooMany : MESSAGES.notRunning;
  if (!before.updateAvailable && after.updateAvailable) return MESSAGES.updated;
  if (action.type === "failed") {
    const was = before[action.slice];
    const now = after[action.slice];
    if (now?.status === "error" && !(was?.status === "error" && was.message === now.message)) return now.message;
  }
  return null;
}
