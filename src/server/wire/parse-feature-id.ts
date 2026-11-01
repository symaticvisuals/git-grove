import { featureId } from "./feature-id.js";

/** The repository and feature name a `featureId` encodes, or null for any other string. */
export function parseFeatureId(id: string): { repoId: number; name: string } | null {
  const match = /^(\d{1,15})\.([A-Za-z0-9_-]+)$/.exec(id);
  if (match === null) return null;
  const repoId = Number(match[1]);
  const name = Buffer.from(match[2] ?? "", "base64url").toString("utf8");
  return featureId(repoId, name) === id ? { repoId, name } : null;
}
