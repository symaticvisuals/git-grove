import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { GitError } from "./git.error.js";

export type RunGitOptions = {
  cwd: string;
  input?: string;
  env?: Record<string, string>;
  write?: boolean;
  allowFailure?: boolean;
};

export type RunGitResult = { stdout: string; stderr: string; code: number };

const MAX_BUFFER = 64 * 1024 * 1024;

/** The most output grove reads from one call; `GIT_GROVE_MAX_BUFFER` lowers it for tests. */
function maxBuffer(): number {
  const override = Number(process.env["GIT_GROVE_MAX_BUFFER"]);
  return Number.isSafeInteger(override) && override > 0 ? override : MAX_BUFFER;
}

function exitStatus(error: Error): number | null {
  return "code" in error && typeof error.code === "number" ? error.code : null;
}

function errorCode(error: Error): unknown {
  return "code" in error ? error.code : undefined;
}

function killSignal(error: Error): string | null {
  return "signal" in error && typeof error.signal === "string" ? error.signal : null;
}

/** Why git did not exit on its own, or null when the failure is not git's (such as no git on PATH). */
function abortReason(error: Error, cwd: string, limit: number): string | null {
  if (errorCode(error) === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return `printed more than ${limit} bytes`;
  const signal = killSignal(error);
  if (signal !== null) return `was killed by ${signal}`;
  if (errorCode(error) === "ENOENT" && !existsSync(cwd)) return `cannot run: the folder ${cwd} does not exist`;
  return null;
}

/**
 * Runs git with the inherited environment and resolves with its output. Git never fetches missing objects
 * of a partial clone (`GIT_NO_LAZY_FETCH=1`).
 * Read calls get `--no-optional-locks` so watching never contends with the user's own git;
 * pass `write: true` for commands that change the repository.
 * Rejects with GitError on a non-zero exit unless `allowFailure` is set, and always when git could not finish:
 * `cwd` does not exist, git was killed, or it printed more than grove reads.
 */
export function runGit(args: readonly string[], options: RunGitOptions): Promise<RunGitResult> {
  const fullArgs = options.write ? [...args] : ["--no-optional-locks", ...args];
  const limit = maxBuffer();
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      fullArgs,
      {
        cwd: options.cwd,
        maxBuffer: limit,
        encoding: "utf8",
        env: { ...process.env, ...options.env, GIT_NO_LAZY_FETCH: "1" },
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout, stderr, code: 0 });
          return;
        }
        const code = exitStatus(error);
        const reason = code === null ? abortReason(error, options.cwd, limit) : null;
        if (code !== null && options.allowFailure) resolve({ stdout, stderr, code });
        else if (code !== null) reject(new GitError(args, code, stderr));
        else if (reason !== null) reject(new GitError(args, -1, stderr, reason));
        else reject(error);
      },
    );
    if (options.input !== undefined) child.stdin?.end(options.input);
  });
}
