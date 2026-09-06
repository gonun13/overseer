# Overseer

A single-page web console for driving CLI coding agents. 

For now only `claude-code` and `cursor` are fully wired providers but others are ready to be implemented.

Built sandboxed, with the paranoid in mind: protect the host from runaway LLMs.
Agents run in Docker, not on your desktop — they cannot wipe your home directory or
reach your real accounts. The only shared surface is `/workspace`; keep those
projects on external git remotes so a bad run is recoverable.

## Trade-offs

| 🟢 Advantages | 🔴 Disadvantages |
| --- | --- |
| Sandboxed isolation from the host | Slower than a bare CLI |
| A better UI experience than a raw CLI | Fewer features than a single-provider tool |
| Multi-provider support | Docker footprint instead of a single binary |
| More observability across projects |  |
| Automatic workflows via the dev loop |  |

## Requirements

- [Docker](https://docs.docker.com/get-docker/) with Compose

Nothing else. Node, npm, and the agent CLIs all live inside the container.

## This never runs on the host

Overseer and the agents it spawns always run **inside Docker**.
Provider auth lives inside the container volume not your real `~/.<agent>` folder.

They cannot reach your machine except through the `./workspace` bind mount;
Workspace projects whose test commands are themselves `docker compose` get a
Docker-in-Docker sidecar rather than a bind of your host's daemon socket.

> [!WARNING]
> There is no authentication. Overseer is designed for a single developer on
> their own local machine — do not expose it on a public interface or deploy it
> as a public instance.

> [!WARNING]
> Do not start the Node server or agent CLI with host `npm` / Node — that skips the
> container entirely. `npm run dev` and `npm run dev:web` refuse outside Docker.
> Use `./bin/*` instead.

## Run (production)

```sh
./bin/start
```

Open http://127.0.0.1:3000. The compiled SPA is served by the Node server. The container
owns the agents as named volumes;

Provider usage and limit reset phrases follow the container timezone (`TZ`). Default is
UTC. To use your local zone, copy `.env.example` to `.env` and uncomment a `TZ=…` line
(Compose loads it automatically).

```sh
./bin/stop
```

## Develop

```sh
./bin/dev-start
```

Vite on http://127.0.0.1:5173 (hot reload), API on http://127.0.0.1:3001. The host ports
differ from production's `:3000` so both stacks can run at once. Edit files on the host —
the source tree is bind-mounted and watched.

| Command            | What it does                                                                 |
| ------------------ | ---------------------------------------------------------------------------- |
| `./bin/dev-start`  | Start the dev stack (`-d` to detach, `--build` to rebuild) |
| `./bin/dev-stop`   | Stop it; volumes survive                                                     |
| `./bin/rebuild`    | Force-rebuild images (`--prod` for production; flags pass to `compose build`) |
| `./bin/start`      | Build and run the production stack                                           |
| `./bin/stop`       | Stop the production stack                                                    |
| `./bin/logs [svc]` | Follow dev stack logs (`deps`, `server`, `web`)                              |
| `./bin/sh [svc]`   | Shell into a dev container (defaults to `server`)                            |
| `./bin/npm <args>` | Run npm inside the dev container — use for **all** dependency work           |
| `./bin/check`      | Typecheck + lint                                                             |
| `./bin/test`       | Run all unit and integration tests                                           |
| `./bin/test-e2e`   | Playwright acceptance tests (args pass through to `playwright test`)         |
| `./bin/loop <ws>`  | Open a dev-loop session on `workspace/<ws>`, inside the running stack        |
| `./bin/reset`      | Tear down the dev stack and discard volumes, including agent auth            |

## Features

- **Overseer space** — ranks what needs attention and opens the surface it refers to.
- **Wizard** — walks a fresh instance from nothing to a working setup.
- **Project panel** — persistent status for every project, plus project creation.
- **Sessions** — spawned, streamed, resumed, and deleted as draggable windows, with
  per-session model, permission mode, and subagent controls.
- **Plans** — `/plans` surfaces plans a session has produced and continues them where
  they left off.
- **Console** — a raw PTY escape hatch straight into the provider CLI.
- **Dev loop tool, in-app** — `/loop` runs the dev loop in a console window.
- **Inline approvals** — permission requests are answered right in the session that
  raised them.
- **Theme support** — samaritan (default) and machine already included.
- And much more to come...

Architecture: [docs/architecture-design.md](docs/architecture-design.md) ·
UI: [docs/ui-ux-design.md](docs/ui-ux-design.md) ·
Behavior: [docs/overseer-behavior.md](docs/overseer-behavior.md)

Themes inspired by Person of Interest created by Jonathan Nolan

### Browser tooling (optional)

A [Playwright MCP server](https://github.com/microsoft/playwright-mcp) is registered in
`.mcp.json` for editor-side click-through against a running stack
(`./bin/dev-start`). Acceptance tests still run only via
`./bin/test-e2e`.