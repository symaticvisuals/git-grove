import type { StoredRepo } from "../../core/journal/store.types.js";
import { HttpError } from "../http/http.error.js";
import type { ServerContext } from "../server-context.types.js";

/** The registered repository with id `id` (a decimal string), or a 404 HttpError. */
export function findRepo(ctx: ServerContext, id: string): StoredRepo {
  const repo = /^\d+$/.test(id) ? ctx.snapshots.repos().find((candidate) => candidate.id === Number(id)) : undefined;
  if (repo === undefined) throw new HttpError(404, "unknown repository");
  return repo;
}
