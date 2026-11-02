import type { Receipt } from "../../src/core/actions/plan.types.js";
import { isRecord } from "./is-record.js";

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isPin(value: unknown): boolean {
  return isRecord(value) && typeof value["ref"] === "string" && typeof value["reused"] === "boolean";
}

function isTarget(value: unknown): boolean {
  return isRecord(value) && typeof value["branch"] === "string" && typeof value["pinRef"] === "string";
}

/** Whether `value` has a receipt's fields: what ran, whether it worked or was refused, its title and lines, its pins, its undo targets or null, and when. */
export function isReceipt(value: unknown): value is Receipt {
  return (
    isRecord(value) &&
    typeof value["action"] === "string" &&
    typeof value["ok"] === "boolean" &&
    typeof value["refused"] === "boolean" &&
    typeof value["title"] === "string" &&
    isStrings(value["lines"]) &&
    Array.isArray(value["pins"]) &&
    value["pins"].every(isPin) &&
    (value["undo"] === null || (Array.isArray(value["undo"]) && value["undo"].every(isTarget))) &&
    typeof value["at"] === "number"
  );
}
