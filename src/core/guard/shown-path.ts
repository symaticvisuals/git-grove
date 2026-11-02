import { isAbsolute, relative, sep } from "node:path";

const MAX_CLIMB = 2;

/** `path` as the agent standing in `from` would type it: relative, unless that climbs more than two folders up. */
export function shownPath(from: string, path: string): string {
  const rel = relative(from, path);
  if (rel === "") return ".";
  const climbs = rel.split(sep).filter((part) => part === "..").length;
  return isAbsolute(rel) || climbs > MAX_CLIMB ? path : rel;
}
