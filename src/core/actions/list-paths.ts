const MAX_PATHS = 3;

/** Up to three paths joined with commas, then `and N more`. */
export function listPaths(paths: string[]): string {
  const shown = paths.slice(0, MAX_PATHS).join(", ");
  return paths.length > MAX_PATHS ? `${shown} and ${paths.length - MAX_PATHS} more` : shown;
}
