/** Whether `bin` runs from a package runner's cache (`npx`, `pnpm dlx`), which the runner may clear at any time. */
export function isEphemeralBin(bin: string): boolean {
  const path = bin.replaceAll("\\", "/");
  return path.includes("/_npx/") || path.includes("/pnpm/dlx/");
}
