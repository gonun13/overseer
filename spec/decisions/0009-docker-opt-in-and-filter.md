# Docker for workspace projects: opt-in, and filtered

Every instance ran a privileged Docker-in-Docker sidecar, and every console could reach its daemon
over plain tcp on the compose network. That was documented as a known limit, but it sat badly with
the first line of the project: an agent that asked that daemon for a privileged container was out
of the sandbox, onto the host on Linux and into Docker Desktop's VM elsewhere. Most projects never
needed the daemon at all.

What this changes in settled spec:

- **The sidecar is off by default.** `OVERSEER_DOCKER=1` in `.env` turns it on. An instance that
  had used it and has not chosen is refused at start until it says which it wants, because the
  alternative is `docker` disappearing from its consoles without a word. This is a changed default
  and needs the operator's version decision before it ships.
- **Consoles no longer reach the daemon.** It listens on a unix socket in a volume only the new
  `docker-filter` service mounts. The filter answers a short list of requests and refuses a
  container that asks for privileged mode, the sidecar's namespaces or devices, or a mount from
  outside the directories the sidecar shares with the app.
- **Something that worked is now refused**: a workspace container that mounts the Docker socket to
  start other containers, and anything else on the filter's list. That is the point of the list.

The filter narrows the grant; it does not seal it, and the spec says where it stops.

Updated `PROJECT.md` requirement 2, `architecture.md` §5, §6.3, §8.1 and §9, `data.md` §1,
`tests.md`, `SECURITY.md`, the README and `.env.example`.
