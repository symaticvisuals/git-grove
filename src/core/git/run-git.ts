import { execFile } from "node:child_process";
import { GitError } from "./git.error.js";

export type RunGitOptions = {
  cwd: string;
  input?: string;
  write?: boolean;
  allowFailure?: boolean;
};

export type RunGitResult = { stdout: string; stderr: string; code: number };

const MAX_BUFFER = 64 * 1024 * 1024;

function exitStatus(error: Error): number | null {
  return "code" in error && typeof error.code === "number" ? error.code : null;
}

/**
 * Runs git with the inherited environment and resolves with its output.
 * Read calls get `--no-optional-locks` so watching never contends with the user's own git;
 * pass `write: true` for commands that change the repository.
 * Rejects with GitError on a non-zero exit unless `allowFailure` is set.
 */
export function runGit(args: readonly string[], options: RunGitOptions): Promise<RunGitResult> {
  const fullArgs = options.write ? [...args] : ["--no-optional-locks", ...args];
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      fullArgs,
      { cwd: options.cwd, maxBuffer: MAX_BUFFER, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout, stderr, code: 0 });
          return;
        }
        const code = exitStatus(error);
        if (code === null) reject(error);
        else if (options.allowFailure) resolve({ stdout, stderr, code });
        else reject(new GitError(args, code, stderr));
      },
    );
    if (options.input !== undefined) child.stdin?.end(options.input);
  });
}
