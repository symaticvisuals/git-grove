/** A request to git grove that did not give what was asked for. `status` is 0 when nothing answered. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
