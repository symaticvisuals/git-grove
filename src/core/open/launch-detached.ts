import { spawn } from "node:child_process";

/**
 * Starts `cmd` detached from this process, with no stdio, and resolves once it has spawned.
 * Rejects with `<command> not found; set it in ~/.git-grove/config.json` when the command does not exist, and with
 * the spawn error otherwise.
 */
export function launchDetached(cmd: { argv: string[]; cwd: string }): Promise<void> {
  const [command, ...args] = cmd.argv;
  if (command === undefined) return Promise.reject(new Error("no command to start"));
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: cmd.cwd, detached: true, stdio: "ignore" });
    child.once("error", (error: NodeJS.ErrnoException) => {
      reject(error.code === "ENOENT" ? new Error(`${command} not found; set it in ~/.git-grove/config.json`) : error);
    });
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
