import type { ServerEvent } from "../../src/server/live/server-event.types.js";
import { isActivityItem } from "./is-activity-item.js";
import { isReceipt } from "./is-receipt.js";
import { isRecord } from "./is-record.js";
import { isStepEvent } from "./is-step-event.js";

/** Whether `value` is one of the events `/events` sends, judged by its type and top-level fields. */
export function isServerEvent(value: unknown): value is ServerEvent {
  if (!isRecord(value)) return false;
  switch (value["type"]) {
    case "hello":
      return typeof value["version"] === "string";
    case "digest":
      return typeof value["repoId"] === "number" && typeof value["digest"] === "string" && typeof value["at"] === "number";
    case "activity":
      return isActivityItem(value["item"]);
    case "step":
      return typeof value["runId"] === "string" && isStepEvent(value["event"]);
    case "receipt":
      return typeof value["runId"] === "string" && isReceipt(value["receipt"]);
    default:
      return false;
  }
}
