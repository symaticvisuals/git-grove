import type { Receipt, StepEvent } from "../../core/actions/plan.types.js";
import type { ActivityItem } from "../wire/wire.types.js";

/** What `/events` carries: each is sent as `event: <type>` with the JSON as `data`. */
export type ServerEvent =
  | { type: "hello"; version: string }
  | { type: "digest"; repoId: number; digest: string; at: number }
  | { type: "activity"; item: ActivityItem }
  | { type: "step"; runId: string; event: StepEvent }
  | { type: "receipt"; runId: string; receipt: Receipt };
