import { execFile } from "node:child_process";

const TIMEOUT_MS = 10 * 60 * 1000;

function lastLine(text: string): string | null {
  return text.split("\n").map((line) => line.trim()).filter((line) => line !== "").at(-1) ?? null;
}

/**
 * Runs `argv` in `cwd`, giving it ten minutes. Rejects with one line saying why it failed: the last line of its
 * stderr, else its error message.
 */
export function runInstall(cwd: string, argv: string[]): Promise<void> {
  const [command, ...args] = argv;
  if (command === undefined) return Promise.reject(new Error("no install command"));
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error === null) {
        resolve();
        return;
      }
      const timedOut = "killed" in error && error.killed === true;
      reject(new Error(timedOut ? "timed out after 10 minutes" : (lastLine(stderr) ?? error.message.split("\n")[0] ?? "failed")));
    });
  });
}
