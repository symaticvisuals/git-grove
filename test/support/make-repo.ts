import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runGit } from "../../src/core/git/run-git.js";

export type TestRepo = {
  path: string;
  git: (...args: string[]) => Promise<string>;
  commit: (file: string, text: string, message: string, date?: string) => Promise<string>;
  branch: (name: string, from?: string) => Promise<void>;
  switch: (name: string) => Promise<void>;
  worktree: (path: string, branch: string, from?: string) => Promise<void>;
  cleanup: () => Promise<void>;
};

const COMMIT_CREATING = new Set(["commit", "merge", "tag", "cherry-pick", "rebase", "revert", "am", "pull", "stash"]);

const CLOCK_START = Date.UTC(2026, 10, 1, 10, 0, 0);

function isoSeconds(ms: number): string {
  return new Date(ms).toISOString().replace(".000Z", "Z");
}

/**
 * Creates a throwaway repository on `main` with a fixed author and a clock that advances one minute per commit.
 */
export async function makeRepo(): Promise<TestRepo> {
  const path = await mkdtemp(join(tmpdir(), "git-grove-repo-"));
  let tick = 0;

  const identityEnv = (date: string): Record<string, string> => ({
    GIT_AUTHOR_NAME: "Test Author",
    GIT_AUTHOR_EMAIL: "author@example.com",
    GIT_COMMITTER_NAME: "Test Author",
    GIT_COMMITTER_EMAIL: "author@example.com",
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  });

  const nextDate = (): string => isoSeconds(CLOCK_START + tick++ * 60_000);

  const run = async (args: string[], date?: string): Promise<string> => {
    const when = date ?? isoSeconds(CLOCK_START + (COMMIT_CREATING.has(args[0] ?? "") ? tick++ : Math.max(tick - 1, 0)) * 60_000);
    return (await runGit(args, { cwd: path, write: true, env: identityEnv(when) })).stdout;
  };

  const git = (...args: string[]): Promise<string> => run(args);

  await git("init", "-b", "main");

  return {
    path,
    git,
    async commit(file, text, message, date) {
      const when = date ?? nextDate();
      await mkdir(dirname(join(path, file)), { recursive: true });
      await writeFile(join(path, file), text);
      await git("add", "--", file);
      await run(["commit", "-m", message], when);
      return (await git("rev-parse", "HEAD")).trim();
    },
    async branch(name, from) {
      await git("branch", name, ...(from ? [from] : []));
    },
    async switch(name) {
      await git("switch", name);
    },
    async worktree(worktreePath, branch, from) {
      await git("worktree", "add", "-b", branch, worktreePath, ...(from ? [from] : []));
    },
    async cleanup() {
      await rm(path, { recursive: true, force: true });
    },
  };
}
