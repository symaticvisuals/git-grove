import type { StepEvent } from "../../src/core/actions/plan.types.js";
import { isRecord } from "./is-record.js";

const STATES: readonly string[] = ["running", "done", "failed", "skipped"];

/** Whether `value` has a step event's fields: a step index, one of its four states, a detail and a time or null. */
export function isStepEvent(value: unknown): value is StepEvent {
  return (
    isRecord(value) &&
    typeof value["index"] === "number" &&
    typeof value["state"] === "string" &&
    STATES.includes(value["state"]) &&
    typeof value["detail"] === "string" &&
    (value["ms"] === null || typeof value["ms"] === "number")
  );
}
