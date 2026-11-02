import type { ActivityItem } from "../../src/server/wire/wire.types.js";
import { isRecord } from "./is-record.js";

/** Whether `value` has an activity item's top-level fields. */
export function isActivityItem(value: unknown): value is ActivityItem {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    typeof value["repoId"] === "number" &&
    typeof value["at"] === "number" &&
    typeof value["kind"] === "string" &&
    (value["branch"] === null || typeof value["branch"] === "string") &&
    typeof value["title"] === "string" &&
    typeof value["detail"] === "string" &&
    typeof value["severity"] === "string"
  );
}
