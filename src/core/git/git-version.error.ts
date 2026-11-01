export class GitVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitVersionError";
  }
}
