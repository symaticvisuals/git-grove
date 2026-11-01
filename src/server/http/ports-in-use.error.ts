/** Every port the server may take, `from` to `to`, is taken by something else. */
export class PortsInUseError extends Error {
  constructor(
    readonly from: number,
    readonly to: number,
  ) {
    super(`git-grove: ports ${from} to ${to} are all in use`);
    this.name = "PortsInUseError";
  }
}
