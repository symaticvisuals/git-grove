/** A feature's id on the wire: `<repoId>.<base64url(name)>`. */
export function featureId(repoId: number, name: string): string {
  return `${repoId}.${Buffer.from(name, "utf8").toString("base64url")}`;
}
