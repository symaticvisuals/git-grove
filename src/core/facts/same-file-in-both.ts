import { join } from "node:path";
import { sameBytes } from "./same-bytes.js";

/**
 * Reports whether `relative` exists under both roots as a regular file with identical bytes.
 * Sizes are compared before hashing; a missing or non-regular file is not the same.
 */
export async function sameFileInBoth(left: string, right: string, relative: string): Promise<boolean> {
  return sameBytes(join(left, relative), join(right, relative));
}
