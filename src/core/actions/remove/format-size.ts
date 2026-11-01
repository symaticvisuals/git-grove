const UNITS = ["kB", "MB", "GB", "TB"];

/** A byte count as a person reads it: `512 B`, `2.1 kB`, `3.4 MB`, in powers of 1000. */
export function formatSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 999.95 && unit < UNITS.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value.toFixed(1)} ${UNITS[unit] ?? "B"}`;
}
