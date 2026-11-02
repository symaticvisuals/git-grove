import { isEphemeralBin } from "../is-ephemeral-bin.js";

const REFUSAL =
  "This git grove runs from a package runner's cache (npx, pnpm dlx, bunx, yarn dlx), which may be cleared under the hook; install it first: npm i -g @deepanshugoel/git-grove";

/** Why grove will not point Claude Code's hook at `bin`, a package runner's cache (`isEphemeralBin`); null for any other bin. */
export function ephemeralRefusal(bin: string): string | null {
  return isEphemeralBin(bin) ? REFUSAL : null;
}
