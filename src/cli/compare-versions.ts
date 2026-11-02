type Parsed = { parts: [number, number, number]; pre: string | null };

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parse(version: string): Parsed | null {
  const match = VERSION.exec(version.trim());
  if (match === null) return null;
  return { parts: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ?? null };
}

/**
 * Compares two `x.y.z` versions: negative when `a` is older, positive when newer, 0 when equal. A pre-release
 * (`1.0.0-beta.1`) comes before its release. Anything that is not `x.y.z` compares equal to everything.
 */
export function compareVersions(a: string, b: string): number {
  const one = parse(a);
  const other = parse(b);
  if (one === null || other === null) return 0;
  for (let index = 0; index < 3; index++) {
    const diff = (one.parts[index] ?? 0) - (other.parts[index] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  if (one.pre === other.pre) return 0;
  if (one.pre === null) return 1;
  if (other.pre === null) return -1;
  return one.pre.localeCompare(other.pre, "en", { numeric: true });
}
