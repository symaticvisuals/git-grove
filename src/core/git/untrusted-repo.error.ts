/**
 * A git call under the guard's lockdown, in a bare repository grove does not know. Its config could run commands,
 * so grove does not run git there at all.
 */
export class UntrustedRepoError extends Error {
  constructor(readonly cwd: string) {
    super(`git-grove: ${cwd} is a bare repository grove does not know`);
    this.name = "UntrustedRepoError";
  }
}
