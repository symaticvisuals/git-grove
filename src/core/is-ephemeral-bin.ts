/** Whether `bin` runs from a package runner's cache (`npx`, `pnpm dlx`, `bunx`, `yarn dlx`), which may be cleared at any time. */
export function isEphemeralBin(bin: string): boolean {
  const path = bin.replaceAll("\\", "/");
  return path.includes("/_npx/") || path.includes("/pnpm/dlx/") || path.includes("/bunx-") || /\/xfs-[^/]*\/dlx-/.test(path);
}
