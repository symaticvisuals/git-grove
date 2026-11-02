import type { Health } from "../../src/server/wire/health-of.js";

/** What each health is called in the dashboard. */
export const HEALTH_LABEL: Record<Health, string> = {
  loses: "Could lose work",
  action: "Needs an action",
  review: "Waiting on review",
  idle: "Idle",
  fine: "Fine",
};
