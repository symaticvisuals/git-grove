import { GitError } from "./git.error.js";

/** Resolves to `fallback` when `work` rejects with a GitError; any other rejection passes through. */
export async function unlessGitFails<T, F>(work: Promise<T>, fallback: F): Promise<T | F> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof GitError) return fallback;
    throw error;
  }
}
