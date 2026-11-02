import { watch, type FSWatcher } from "node:fs";

export type WatchRepoOptions = { debounceMs?: number | undefined; pollMs?: number | undefined };

const RELEVANT = /^(refs\/|packed-refs$|HEAD$|index$|logs\/|worktrees\/[^/]+\/(HEAD|index)$|grove\.lock$)/;

/**
 * Calls `onChange` once, `debounceMs` (300) after the last relevant change under `commonDir` (refs, packed-refs, HEAD,
 * the index, reflogs, each worktree's HEAD and index, and grove.lock), and every `pollMs` (30 000) regardless.
 * When the folder cannot be watched, or the watch fails, the poll carries on alone. `close` stops the watch and both timers.
 */
export function watchRepo(commonDir: string, onChange: () => void, options: WatchRepoOptions = {}): { close(): void } {
  const debounceMs = options.debounceMs ?? 300;
  const pollMs = options.pollMs ?? 30_000;
  let debounce: NodeJS.Timeout | null = null;
  let watcher: FSWatcher | null = null;
  let closed = false;

  const fire = (): void => {
    if (!closed) onChange();
  };
  const schedule = (): void => {
    if (debounce !== null) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      fire();
    }, debounceMs);
  };

  try {
    watcher = watch(commonDir, { recursive: true }, (_event, filename) => {
      if (filename !== null && RELEVANT.test(filename.replaceAll("\\", "/"))) schedule();
    });
    watcher.on("error", () => {
      watcher?.close();
      watcher = null;
    });
  } catch {
    watcher = null;
  }

  const poll = setInterval(fire, pollMs);
  poll.unref();

  return {
    close() {
      closed = true;
      if (debounce !== null) clearTimeout(debounce);
      clearInterval(poll);
      watcher?.close();
      watcher = null;
    },
  };
}
