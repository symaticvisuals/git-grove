export class BareRepoError extends Error {
  constructor() {
    super("git-grove: bare repositories are not supported yet");
    this.name = "BareRepoError";
  }
}
