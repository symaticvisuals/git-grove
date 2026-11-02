import { stat } from "node:fs/promises";
import { uptime } from "node:os";

/** Whether the file at `path` was last written before this machine booted; false when it cannot be read. */
export async function predatesBoot(path: string): Promise<boolean> {
  const written = await stat(path).then(
    (info) => info.mtimeMs,
    () => null,
  );
  return written !== null && written < Date.now() - uptime() * 1000;
}
