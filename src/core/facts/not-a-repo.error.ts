export class NotARepoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotARepoError";
  }
}
