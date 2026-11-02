import { ago } from "./ago.js";
import { clockTime } from "./clock-time.js";

/** The text a `<time data-at>` element should show at `now`: a 24-hour clock time when it has `data-clock`, else how long ago, short or long by `data-ago`. */
export function timeLabel(data: { readonly [key: string]: string | undefined }, now: number): string {
  const at = Number(data["at"]);
  if (data["clock"] !== undefined) return clockTime(at, now);
  return ago(at, now, data["ago"] === "long" ? "long" : "short");
}
