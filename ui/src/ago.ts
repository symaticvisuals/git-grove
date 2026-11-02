const UNITS: [number, string, string][] = [
  [86_400_000, "d", "d"],
  [3_600_000, "h", "h"],
  [60_000, "m", "min"],
];

const MAX_TIME = 8.64e15;

/**
 * How long ago `at` was, from `now`. `short` is `now`, `4m`, `3h` or `16d`, for list rows; `long` is `3 s ago`,
 * `4 min ago`, `3 h ago` or `16 d ago`. A time that is not a real date is `—`.
 */
export function ago(at: number, now: number, form: "short" | "long" = "short"): string {
  if (!Number.isFinite(at) || !Number.isFinite(now) || Math.abs(at) > MAX_TIME) return "—";
  const elapsed = Math.max(0, now - at);
  for (const [size, short, long] of UNITS) {
    if (elapsed >= size) {
      const count = Math.floor(elapsed / size);
      return form === "short" ? `${count}${short}` : `${count} ${long} ago`;
    }
  }
  return form === "short" ? "now" : `${Math.floor(elapsed / 1000)} s ago`;
}
