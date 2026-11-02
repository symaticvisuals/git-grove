import { copyFile, stat, truncate } from "node:fs/promises";

/**
 * When the log at `path` is over `maxBytes`, copies it to `<path>.1` (replacing the older copy) and empties it.
 * It is emptied rather than renamed, so the login service's descriptor, opened for appending, keeps writing to
 * `path`. Resolves whether it rotated.
 */
export async function rotateLog(path: string, maxBytes: number): Promise<boolean> {
  const size = await stat(path).then(
    (info) => info.size,
    () => 0,
  );
  if (size <= maxBytes) return false;
  await copyFile(path, `${path}.1`);
  await truncate(path, 0);
  return true;
}
