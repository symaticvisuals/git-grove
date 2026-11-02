import type { ServerEvent } from "../../src/server/live/server-event.types.js";

/** Whether this page may raise system notifications; `unsupported` where the browser has none. */
export type NotifyPermission = "default" | "granted" | "denied" | "unsupported";

/** A system notification to raise, and the route a click on it opens. */
export type GroveNotification = { title: string; body: string; tag: string; icon: string; href: string };

/**
 * The notification an event raises: one for each activity item that loses work, with the item's title as its body
 * and its id as its tag, so the same item seen by two tabs shows once. Null for every other event.
 */
export function notificationFor(event: ServerEvent): GroveNotification | null {
  if (event.type !== "activity" || event.item.severity !== "loses-work") return null;
  return { title: "git grove", body: event.item.title, tag: event.item.id, icon: "/icons/icon-192.png", href: "#/needs" };
}
