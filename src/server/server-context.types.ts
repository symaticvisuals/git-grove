import type { PlanCache } from "./actions/plan-cache.js";
import type { Runs } from "./actions/runs.js";
import type { GuardInstaller } from "./guard/guard-installer.js";
import type { Hub } from "./live/hub.js";
import type { Snapshots } from "./live/snapshots.js";
import type { Store } from "../core/journal/store.types.js";

/**
 * What every route handler gets: the open store, its snapshots, the hub, the previewed plans and the runs, the agent
 * guard's installer, the server's token, port, version and home, and a way to stop it.
 */
export type ServerContext = {
  store: Store;
  snapshots: Snapshots;
  hub: Hub;
  plans: PlanCache;
  runs: Runs;
  guard: GuardInstaller;
  token: string;
  port: number;
  version: string;
  home: string;
  /** Closes the server after the response in flight, then calls `onShutdown(code)`. */
  shutdown(code: number): void;
};
