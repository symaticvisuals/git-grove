import { spawn } from "node:child_process";

const TIMEOUT_MS = 10 * 60 * 1000;

function lastLine(text: string): string | null {
  return text.split("\n").map((line) => line.trim()).filter((line) => line !== "").at(-1) ?? null;
}

/**
 * Runs `argv` in `cwd` with no stdin, giving it ten minutes. Rejects with one line saying why it failed: the last line
 * of its stderr, else its exit status or the spawn error.
 */
export function runInstall(cwd: string, argv: string[]): Promise<void> {
  const [command, ...args] = argv;
  if (command === undefined) return Promise.reject(new Error("no install command"));
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "ignore", "pipe"], timeout: TIMEOUT_MS });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-8192);
    });
    child.once("error", (error) => reject(error));
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else if (signal !== null) reject(new Error(`timed out after 10 minutes (${signal})`));
      else reject(new Error(lastLine(stderr) ?? `exited with status ${code}`));
    });
  });
}
