import { spawn } from "node:child_process";

const SETTLE_MS = 3000;

/**
 * Opens `url` in the default browser with `open` (macOS) or `xdg-open` (Linux), passing it as one argument, never
 * through a shell. Resolves false when the opener is missing or exits non-zero, and on any other platform; an opener
 * still running after 3 s counts as opened.
 */
export function openUrl(url: string, platform: NodeJS.Platform = process.platform): Promise<boolean> {
  const command = platform === "darwin" ? "open" : platform === "linux" ? "xdg-open" : null;
  if (command === null) return Promise.resolve(false);
  return new Promise((resolve) => {
    const child = spawn(command, [url], { detached: true, stdio: "ignore" });
    const settle = setTimeout(() => {
      child.unref();
      resolve(true);
    }, SETTLE_MS);
    child.once("error", () => {
      clearTimeout(settle);
      resolve(false);
    });
    child.once("exit", (code) => {
      clearTimeout(settle);
      resolve(code === 0);
    });
  });
}
