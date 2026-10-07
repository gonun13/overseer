# Security

Overseer runs coding agents with a shell and gives them a web page to drive them from. Running code
is what it is for, so a report is useful only when it shows a boundary below failing to hold. This
page says which boundaries are meant to hold and how to report a break in one privately.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting:
**[Report a vulnerability](https://github.com/gonun13/overseer/security/advisories/new)** (or
Security › Advisories › Report a vulnerability on the repository page).

Do not open a public issue, discussion or pull request for anything that might be in scope. If you
are not sure, report it privately and let the maintainer decide.

Please include:

- the Overseer version (shown in the app footer) and whether you ran the production stack
  (`./bin/start`) or the dev stack (`./bin/dev-start`);
- the host OS and Docker variant (Docker Desktop, Docker Engine on Linux, OrbStack, Colima, …);
- steps to reproduce, and what an attacker gets at the end.

Overseer has a single maintainer, so replies are best effort. The fix ships in a patch release, and
its changelog entry names only the class of issue. You will be credited in the advisory unless
you ask not to be.

Only the latest release gets fixes.

## Threat model

### Who uses it, and how

- **One operator, on their own machine.** There are no accounts, users or roles.
- **Loopback only.** The production stack publishes the app on `127.0.0.1:3000` (dev: `5173` and
  `3001`). Nothing is meant to reach it from another machine.
- **No authentication.** Anything that can open a connection to that port on the operator's machine
  can drive every agent and shell. Keeping other people and untrusted programs off that machine is
  the operator's job.

### What is trusted, and what is not

- The **agents** (Claude Code, Cursor, Codex), the shells and the dev loop are treated as able to
  run any command inside the `overseer` container. That is intended. Overseer does not restrict
  them further: permission modes are the agent CLI's own, and Codex runs with its sandbox off
  because the container is the sandbox.
- **Other web pages open in the operator's browser** are untrusted. They must not be able to drive
  the app.
- **The host** is what the containers protect.

### Boundaries that are meant to hold

These are in scope. A way through any of them is a vulnerability:

1. **The host filesystem.** On the production stack, agents can reach the host only through the
   workspace directory (`../overseer-workspace` by default, mounted as `/workspace`). Reading or
   writing other host paths counts as an escape, as does reaching the host's own Docker socket or
   the host's agent CLI config and credentials, none of which are mounted.
2. **Workspace containment.** A project path the app accepts must resolve inside `/workspace`.
   Getting the app to operate on a path outside it through traversal, symlinks or crafted messages
   counts, and so does reaching the app's internal state under `/app/.overseer`.
3. **Driving the app from a web page.** A page on another origin opening the app's WebSocket,
   calling its API, or otherwise acting as the operator (cross-site requests, Origin checks that
   can be bypassed, DNS rebinding).
4. **Per-console identity.** A process in one console reporting hook events or relaying messages as
   a different console.
5. **Secrets leaving the container through the app.** For example, the private half of the git ssh
   key or a provider token showing up in the UI, in a protocol message or in a file the app writes
   to the workspace.
6. **Exposure by default.** A default configuration that publishes the app or the Docker daemon
   sidecar beyond loopback or the internal compose network.

### Known limits: not vulnerabilities

These follow from the design and are documented. Reports that only restate them will be closed,
but a way to get the same result *without* the documented path is welcome.

- **It runs code.** An agent, a shell or a loop run executing commands, installing packages,
  using the network or deleting files inside the container or the workspace is the product working.
- **Credentials inside the container.** Every signed-in provider's token and the git ssh key live in
  the container's `agent-home` volume. Anything running in the container can read and exfiltrate
  them.
- **The workspace is shared with the host.** Agents can write anything there, including git hooks,
  build scripts and editor config that the host may later run. Treat what agents leave in the
  workspace as untrusted, and keep projects on a git remote so a bad run is recoverable.
- **The Docker sidecar is privileged.** Workspace projects that run `docker compose` need a daemon.
  Overseer ships a `dind` sidecar rather than mounting the host's socket, and every console can
  reach it. A privileged container has wide access to the kernel of the machine Docker runs on:
  that is the host on Linux, and Docker Desktop's VM (which mounts your shared folders) elsewhere.
  This is a known trade-off, not a sealed boundary. See
  [`spec/architecture.md` §6.3](spec/architecture.md#63-the-daemon-that-builds-workspace-projects).
- **The dev stack is not a sandbox.** `./bin/dev-start` mounts the Overseer repo into the container
  with write access, including the `bin/` scripts the host runs. Use the production stack to contain
  agents.
- **Local access.** Any process or user on the operator's machine that can reach the loopback port
  has full control of the app, because there is no authentication.
- **Exposing it yourself.** Publishing the port on another interface, putting it behind a proxy or
  tunnel, or deploying it as a shared instance is unsupported.
- **The agents' own behaviour.** Bugs in the agent CLIs or their sandboxes belong with their
  vendors, unless Overseer makes them worse.

The full security notes are in [`spec/architecture.md` §6](spec/architecture.md#6-security).
