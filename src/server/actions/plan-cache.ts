import { randomBytes } from "node:crypto";
import type { Prepared } from "../../core/actions/action.types.js";

export type PlanCacheOptions = { ttlMs?: number; max?: number; now?: () => number };

export type CachedPlan = { repoId: number; prepared: Prepared };

export type PlanCache = {
  /** Holds `prepared` for `repoId` and returns its id. */
  put(repoId: number, prepared: Prepared): string;
  /** The plan, once. Then `"taken"` until its ttl ends; `"expired"` past the ttl, or for an id it does not hold. */
  take(planId: string): CachedPlan | "expired" | "taken";
  /** What `take` would return, without taking the plan. */
  peek(planId: string): CachedPlan | "expired" | "taken";
};

const TTL_MS = 600_000;
const MAX = 50;

type Entry = { expiresAt: number; plan: CachedPlan | null };

/**
 * Holds previewed plans for `ttlMs` (10 minutes) under ids of 16 random bytes in base64url. At most `max` (50) wait
 * to run; one more drops the oldest. A taken plan keeps only the fact it was taken, until its ttl ends.
 */
export function createPlanCache(options: PlanCacheOptions = {}): PlanCache {
  const ttlMs = options.ttlMs ?? TTL_MS;
  const max = options.max ?? MAX;
  const now = options.now ?? Date.now;
  const entries = new Map<string, Entry>();

  const dropExpired = (): void => {
    const at = now();
    for (const [id, entry] of entries) if (at >= entry.expiresAt) entries.delete(id);
  };

  const makeRoom = (): void => {
    let waiting = [...entries.values()].filter((entry) => entry.plan !== null).length;
    for (const [id, entry] of entries) {
      if (waiting < max) return;
      if (entry.plan === null) continue;
      entries.delete(id);
      waiting -= 1;
    }
  };

  return {
    put(repoId, prepared) {
      dropExpired();
      makeRoom();
      const id = randomBytes(16).toString("base64url");
      entries.set(id, { expiresAt: now() + ttlMs, plan: { repoId, prepared } });
      return id;
    },
    take(planId) {
      dropExpired();
      const entry = entries.get(planId);
      if (entry === undefined) return "expired";
      if (entry.plan === null) return "taken";
      const { plan } = entry;
      entry.plan = null;
      return plan;
    },
    peek(planId) {
      dropExpired();
      const entry = entries.get(planId);
      if (entry === undefined) return "expired";
      return entry.plan ?? "taken";
    },
  };
}
