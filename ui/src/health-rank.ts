import type { Health } from "../../src/server/wire/health-of.js";

/** How bad each health is; lower is worse. */
export const HEALTH_RANK: Record<Health, number> = { loses: 0, action: 1, review: 2, idle: 3, fine: 4 };
