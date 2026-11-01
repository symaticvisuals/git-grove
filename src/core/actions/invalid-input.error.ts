/** An action's input that is not the shape it takes, or names something that cannot be acted on. */
export class InvalidInputError extends Error {
  constructor(readonly reason: string) {
    super(`git-grove: ${reason}`);
    this.name = "InvalidInputError";
  }
}
