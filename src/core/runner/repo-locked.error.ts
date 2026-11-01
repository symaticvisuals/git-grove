export class RepoLockedError extends Error {
  constructor(readonly lockPath: string) {
    super(`git-grove: another grove operation holds ${lockPath}`);
    this.name = "RepoLockedError";
  }
}
