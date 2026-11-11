/**
 * Where a bind source really leads, as the sidecar will see it.
 *
 * This container mounts the same directories at the same paths as the sidecar,
 * read-only, so following a link here follows it there — as long as the link
 * stays inside them. A link pointing anywhere else is the case this exists
 * for: `/workspace/x -> /` names the sidecar's own root.
 */
import { lstatSync, realpathSync } from "node:fs";
import { posix } from "node:path";
import { Denied } from "./policy.ts";

function missing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * Resolve `path`, which may not exist yet: the daemon creates a missing bind
 * source, so the part that exists is resolved and the rest is kept as written.
 */
export function resolveBindSource(path: string): string {
  const rest: string[] = [];
  let current = path;
  for (;;) {
    try {
      return posix.join(realpathSync(current), ...rest);
    } catch (error) {
      if (!missing(error)) {
        throw new Denied(`"${path}" could not be checked`);
      }
    }
    // Nothing resolves here. If something *is* here, it is a link to a place
    // this container cannot see — which in the sidecar may well exist.
    try {
      lstatSync(current);
      throw new Denied(
        `"${path}" goes through a link the filter cannot follow`,
      );
    } catch (error) {
      if (error instanceof Denied) throw error;
      if (!missing(error)) throw new Denied(`"${path}" could not be checked`);
    }
    if (current === "/") throw new Denied(`"${path}" could not be checked`);
    rest.unshift(posix.basename(current));
    current = posix.dirname(current);
  }
}
