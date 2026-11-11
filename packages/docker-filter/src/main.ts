/**
 * Entry point for the `docker-filter` service (compose files).
 *
 *   DOCKER_FILTER_BIND_ROOTS  colon-separated directories a container may
 *                             bind-mount from; required
 *   DOCKER_FILTER_UPSTREAM    the sidecar's socket (/run/dind/docker.sock)
 *   DOCKER_FILTER_PORT        where consoles reach this (2375)
 */
import { realpathSync } from "node:fs";
import { createFilter } from "./server.ts";
import { resolveBindSource } from "./resolve.ts";

const roots = (process.env.DOCKER_FILTER_BIND_ROOTS ?? "")
  .split(":")
  .filter((root) => root.length > 0);
if (roots.length === 0 || roots.some((root) => !root.startsWith("/"))) {
  console.error(
    "docker-filter: DOCKER_FILTER_BIND_ROOTS must list absolute paths",
  );
  process.exit(1);
}

const upstream = process.env.DOCKER_FILTER_UPSTREAM ?? "/run/dind/docker.sock";
const port = Number(process.env.DOCKER_FILTER_PORT ?? "2375");

const server = createFilter({
  upstream,
  policy: {
    // A root that is missing here is one the sidecar does not share either.
    bindRoots: roots.map((root) => realpathSync(root)),
    resolve: resolveBindSource,
  },
  log: (line) => console.log(`docker-filter: ${line}`),
});

server.listen(port, "0.0.0.0", () => {
  console.log(
    `docker-filter: listening on ${port}, binds allowed from ${roots.join(", ")}`,
  );
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => process.exit(0));
}
