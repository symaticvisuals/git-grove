import { MESSAGES } from "./messages.js";
import type { State, UiAction } from "./state.js";

/**
 * What a screen reader should hear after `action` took `before` to `after`, or null: a new alert that needs the
 * user, a load that newly failed (not one that fails again with the same message), the connection dropping, an
 * update, or the page signing out. Repaints announce nothing.
 */
export function announcement(before: State, after: State, action: UiAction): string | null {
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
