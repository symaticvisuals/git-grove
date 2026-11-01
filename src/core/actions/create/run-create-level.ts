import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { readConfig } from "../../config/read-config.js";
import { runGit } from "../../git/run-git.js";
import { appCommand } from "../../open/app-command.js";
import { launchDetached } from "../../open/launch-detached.js";
import { plural } from "../../rules/plural.js";
import type { ExecuteResult, RunContext } from "../action.types.js";
import { displayPath } from "../display-path.js";
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

async function record(root: string, level: NewLevel): Promise<void> {
  const set = (key: string, value: string): Promise<unknown> =>
    runGit(["config", `branch.${level.branch}.${key}`, value], { cwd: root, write: true });
  await set("stackparent", level.parent);
  await set("stackforkpoint", level.forkPoint);
  if (level.recordFeature) await set("grovefeature", level.feature);
}

/**
 * Creates a planned level from `run.firstStep`: its branch and folder, its stack keys, and whichever of ignoring
 * `.worktrees/`, copying env files (never overwriting), installing and opening the editor the plan lists. A failed
 * install or editor launch is a line in the receipt, not a failure; any other failing step stops the run.
 */
export async function runCreateLevel(level: NewLevel, run: RunContext): Promise<ExecuteResult> {
  const { root, commonDir } = run.facts;
  const shown = displayPath(root, level.folder);
  const lines = [`${level.branch} is level ${String(level.depth).padStart(2, "0")} of ${level.feature}, on ${level.parent}`];

  for (const [offset, { key }] of levelSteps(level).entries()) {
    const index = run.firstStep + offset;
    if (key === "create") {
      await run.step(index, async () => {
        await runGit(["worktree", "add", "-b", level.branch, level.folder, level.forkPoint], { cwd: root, write: true });
        return shown;
      });
    } else if (key === "record") {
      await run.step(index, async () => {
        await record(root, level);
        return `${level.branch} is on ${level.parent}`;
      });
    } else if (key === "ignore") {
      await run.step(index, async () => {
        await addToExclude(commonDir);
        return "Added to .git/info/exclude";
      });
    } else if (key === "env") {
      await run.step(index, async () => {
        const { copied, kept } = await copyEnvFiles(level.mainPath, level.folder, level.envFiles);
        const detail = `${plural(copied.length, "env file")} copied${kept.length > 0 ? `, ${kept.length} already there` : ""}`;
        lines.push(detail);
        return detail;
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
