import { existsSync } from "node:fs";
import { join } from "node:path";

const LOCKFILES: { files: string[]; manager: string }[] = [
  { files: ["pnpm-lock.yaml"], manager: "pnpm" },
  { files: ["yarn.lock"], manager: "yarn" },
  { files: ["bun.lock", "bun.lockb"], manager: "bun" },
  { files: ["package-lock.json"], manager: "npm" },
];

/**
 * The install command for the package manager whose lockfile `mainPath` holds, checked in the order pnpm, yarn, bun,
 * npm, or null when there is none.
 */
export function detectInstall(mainPath: string): { argv: string[]; label: string } | null {
  const found = LOCKFILES.find(({ files }) => files.some((file) => existsSync(join(mainPath, file))));
  return found === undefined ? null : { argv: [found.manager, "install"], label: `${found.manager} install` };
}
