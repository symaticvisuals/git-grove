import { execFile } from "node:child_process";
import { homedir } from "node:os";

export type CommandResult = { code: number; stdout: string; stderr: string };

/**
 * What the login service manager needs from the machine: the platform, the user's home folder (under which the
 * agent or unit file goes), the user id (launchd's `gui/<uid>` domain), the `PATH` commands are looked up on, and a
 * way to run `launchctl` or `systemctl`. `run` never rejects: a missing command exits 127.
 */
export type ServiceHost = {
  platform: NodeJS.Platform;
  home: string;
  uid: number;
  path: string;
  run(cmd: string, args: string[]): Promise<CommandResult>;
};

const RUN_TIMEOUT_MS = 120_000;
const MAX_OUTPUT = 64 * 1024 * 1024;

function exitCode(error: Error): number {
  if ("code" in error && typeof error.code === "number") return error.code;
  return "code" in error && error.code === "ENOENT" ? 127 : 1;
}

/** This machine, as the current user sees it. */
export function realServiceHost(): ServiceHost {
  const path = process.env["PATH"] ?? "";
  return {
    platform: process.platform,
    home: homedir(),
    uid: process.getuid?.() ?? -1,
    path,
    run: (cmd, args) =>
      new Promise((resolve) => {
        const env = { ...process.env, PATH: path };
        execFile(cmd, args, { encoding: "utf8", timeout: RUN_TIMEOUT_MS, maxBuffer: MAX_OUTPUT, env }, (error, stdout, stderr) => {
          resolve({ code: error === null ? 0 : exitCode(error), stdout, stderr: error !== null && stderr === "" ? error.message : stderr });
        });
      }),
  };
}
