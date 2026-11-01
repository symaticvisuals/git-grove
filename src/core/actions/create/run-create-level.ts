import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { readConfig } from "../../config/read-config.js";
import { runGit } from "../../git/run-git.js";
import { appCommand } from "../../open/app-command.js";
import { launchDetached } from "../../open/launch-detached.js";
import { plural } from "../../rules/plural.js";
import type { ExecuteResult, RunContext } from "../action.types.js";
import { displayPath } from "../display-path.js";
import { shellWord } from "../shell-word.js";
import { errorLine } from "../error-line.js";
import { copyEnvFiles } from "./copy-env-files.js";
import { levelSteps } from "./level-steps.js";
import type { NewLevel } from "./new-level.types.js";
import { runInstall } from "./run-install.js";

const IGNORE_LINE = ".worktrees/";

async function addToExclude(commonDir: string): Promise<void> {
  const path = join(commonDir, "info", "exclude");
  await mkdir(join(commonDir, "info"), { recursive: true });
  const current = await readFile(path, "utf8").catch(() => "");
  if (current.split("\n").includes(IGNORE_LINE)) return;
  await appendFile(path, `${current === "" || current.endsWith("\n") ? "" : "\n"}${IGNORE_LINE}\n`);
}

async function record(root: string, level: NewLevel, written: string[]): Promise<void> {
  const set = async (key: string, value: string): Promise<void> => {
    await runGit(["config", `branch.${level.branch}.${key}`, value], { cwd: root, write: true });
    written.push(key);
  };
  await set("stackparent", level.parent);
  await set("stackforkpoint", level.forkPoint);
  if (level.recordFeature) await set("grovefeature", level.feature);
}

async function branchExists(root: string, branch: string): Promise<boolean> {
  return (await runGit(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: root, allowFailure: true })).code === 0;
}

async function isRegistered(root: string, folder: string): Promise<boolean> {
  const { stdout } = await runGit(["worktree", "list", "--porcelain"], { cwd: root, allowFailure: true });
  return stdout.split("\n").includes(`worktree ${folder}`);
}

async function leftBehind(root: string, level: NewLevel, written: string[], title: string, error: unknown): Promise<ExecuteResult> {
  const shown = displayPath(root, level.folder);
  const registered = await isRegistered(root, level.folder);
  const hasBranch = await branchExists(root, level.branch);
  const hasFolder = existsSync(level.folder);
  const lines = [`${errorLine(error)}`, "Left behind by this run:"];
  const remove: string[] = [];
  if (registered) {
    lines.push(`  folder ${shown}, a worktree on ${level.branch}`);
    remove.push(`git worktree remove --force ${shellWord(shown)}`);
  } else if (hasFolder) {
    lines.push(`  a half-made folder ${shown}, not a worktree`);
    remove.push(`delete the folder ${shown} yourself`);
  }
  for (const key of written) {
    lines.push(`  config branch.${level.branch}.${key}`);
    remove.push(`git config --unset ${shellWord(`branch.${level.branch}.${key}`)}`);
  }
  if (hasBranch) {
    lines.push(`  branch ${level.branch}`);
    remove.push(`git branch -D ${shellWord(level.branch)}`);
  }
  if (remove.length === 0) lines.push("  nothing; the repository is as it was");
  else lines.push("To undo it, run:", ...remove.map((command) => `  ${command}`));
  return { ok: false, title: `Stopped: ${title}`, lines, undo: null };
}

/**
 * Creates a planned level from `run.firstStep`: its branch and folder, its stack keys, and whichever of ignoring
 * `.worktrees/`, copying env files (never overwriting), installing and opening the editor the plan lists. Creating
 * and recording are essential: a failure there returns a stopped result that lists what now exists and the commands
 * that remove it. Ignoring, copying env files, installing and opening are best effort and become receipt lines.
 */
export async function runCreateLevel(level: NewLevel, run: RunContext): Promise<ExecuteResult> {
  const { root, commonDir } = run.facts;
  const shown = displayPath(root, level.folder);
  const lines = [`${level.branch} is level ${String(level.depth).padStart(2, "0")} of ${level.feature}, on ${level.parent}`];
  const written: string[] = [];

  for (const [offset, { key, title }] of levelSteps(level).entries()) {
    const index = run.firstStep + offset;
    if (key === "create" || key === "record") {
      try {
        await run.step(index, async () => {
          if (key === "create") {
            await runGit(["worktree", "add", "-b", level.branch, level.folder, level.forkPoint], { cwd: root, write: true });
            return shown;
          }
          await record(root, level, written);
          return `${level.branch} is on ${level.parent}`;
        });
      } catch (error) {
        return leftBehind(root, level, written, title, error);
      }
    } else if (key === "ignore") {
      await run.step(index, async () => {
        try {
          await addToExclude(commonDir);
          return "Added to .git/info/exclude";
        } catch (error) {
          const line = `Couldn't add .worktrees/ to .git/info/exclude: ${errorLine(error)}. Add it yourself.`;
          lines.push(line);
          return line;
        }
      });
    } else if (key === "env") {
      await run.step(index, async () => {
        try {
          const { copied, kept } = await copyEnvFiles(level.mainPath, level.folder, level.envFiles);
          const detail = `${plural(copied.length, "env file")} copied${kept.length > 0 ? `, ${kept.length} already there` : ""}`;
          lines.push(detail);
          return detail;
        } catch (error) {
          const line = `Couldn't copy the env files: ${errorLine(error)}. Copy them yourself.`;
          lines.push(line);
          return line;
        }
      });
    } else if (key === "install") {
      await run.step(index, async () => {
        const install = level.install;
        if (install === null) return "";
        try {
          await runInstall(level.folder, install.argv);
          lines.push(`${install.label} finished`);
          return `${install.label} finished`;
        } catch (error) {
          const line = `install failed: ${errorLine(error)}; run ${install.label} there yourself`;
          lines.push(line);
          return line;
        }
      });
    } else {
      await run.step(index, async () => {
        try {
          await launchDetached(appCommand("editor", level.folder, await readConfig(), process.platform));
          return "Opened";
        } catch (error) {
          const line = `could not open the editor: ${errorLine(error)}`;
          lines.push(line);
          return line;
        }
      });
    }
  }
  return { ok: true, title: `Ready: ${shown}`, lines, undo: null };
}
