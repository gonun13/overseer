# Overseer

A single-page web console for driving CLI coding agents. 

For now only `claude` and `cursor` are fully wired providers but others are ready to be implemented.

Built sandboxed, with the paranoid in mind: protect the host from runaway LLMs.
Agents run in Docker, not on your desktop — they cannot wipe your home directory or
reach your real accounts. In production, the only shared surface is `/workspace`; keep those
projects on external git remotes so a bad run is recoverable.
Development also mounts the writable source repo at `/app`, accessible to agent shells.

## Trade-offs

| 🟢 Advantages | 🔴 Disadvantages |
| --- | --- |
| Sandboxed isolation from the host | A browser terminal instead of your own |
| Every CLI feature, as the provider ships it | Docker footprint instead of a single binary |
| Many agents across many projects on one desk |  |
| More observability across projects |  |
| Automatic workflows via the dev loop |  |

## Requirements

- [Docker](https://docs.docker.com/get-docker/) with Compose

Nothing else. Node, npm, and the agent CLIs all live inside the container.

## Where your projects go

Your projects do **not** live in this repo. The first run creates
`../overseer-workspace` — a directory next to this clone — and mounts it into the
container as `/workspace`, the only host surface agents get in production. Put a project there (clone
it, or create one from the UI) and it shows up in the panel.

It sits outside the repo on purpose: inside, a dev container saw every project twice,
and your work sat in the blast radius of the resets and cleans that overseer's own code
tree invites. To keep it elsewhere, set `OVERSEER_WORKSPACE_HOST` in `.env` — see
`.env.example`.

## This never runs on the host

Overseer and the agents it spawns always run **inside Docker**.
Provider auth lives inside the container volume not your real `~/.<agent>` folder.

They cannot reach your machine except through the workspace bind mount, which lives
outside this repo;
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

Configuration is optional and lives in `.env` — copy `.env.example` and uncomment what
you need (Compose loads it automatically). `OVERSEER_WORKSPACE_HOST` moves the workspace;
`TZ` sets the container timezone for CLI usage and limit reset phrases. Default is UTC;
Cursor dashboard reset dates are displayed in UTC regardless of `TZ`.

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
| `./bin/loop <ws>`  | Open a dev-loop session on that workspace project, inside the running stack  |
| `./bin/reset`      | Tear down the dev stack and discard volumes, including agent auth            |

## Features

Overseer is a harness around the providers' own CLIs, not a replacement for them. Every
agent conversation happens in the CLI's real TUI, in a console window. Overseer adds what
a single terminal cannot: many consoles across many projects on one desk, and a view of
all of them at once.

- **Consoles** — any number of console windows, across projects, tiled across the centre
  of the field between a left rail (projects, sessions, shells, provider) and a right rail
  (clock, then the overseer's message, signals and status over the prompt). A console is the provider CLI (`+ new session`, or type a
  prompt into the prompt bar), a plain shell (`/shell`), or the dev loop (`/loop`).
- **Consoles outlive the tab** — closing a window only detaches it; the process keeps
  running on the server. A reload restores console windows and their scrollback,
  then tiles them on the stage. Kill is a separate, explicit control.
- **Sessions** — every provider session in the workspace, read from the CLIs' own
  transcripts. Opening one shows the console running it, or resumes it in a new one
  (`claude --resume`, `agent --resume`).
- **Monitoring** — Claude Code reports through hooks, so a console waiting on a
  permission prompt lights up and the overseer points you straight at it. Other CLIs
  are watched by their output.
- **Callsigns** — every agent session has a person's name (`/rename` changes it).
  `@linda <message>` in the prompt types a prompt into Linda's CLI once it is idle,
  resuming the session if it is dormant. Inside an agent console, `overseer who` and
  `overseer tell <name> <message>` let agents address each other; one that relays too
  often is held for your approval.

Prompt commands also accept these aliases: `/provider` for `/providers`, `/session`
for `/sessions`, `/gitconfig` for `/git`, `/bash` or `/sh` for `/shell`, `/grid` or
`/arrange` for `/tile`, `/system` for `/settings`, `/changes` or `/whatsnew` for
`/changelog`, `/night` or `/day` for `/theme`, and `/dismiss` for `/clear`.
- **Overseer space** — ranks what needs attention and opens the surface it refers to.
- **Wizard** — walks a fresh instance from nothing to a working setup.
- **Project panel** — persistent status for every project, plus project creation.
- **Git over ssh** — generate a key in settings, add its public half to your git host,
  and push from the app or the agent. Works with any host, self-hosted included.
- **Theme support** — samaritan (default) and machine already included.

Spec: [spec/PROJECT.md](spec/PROJECT.md) — architecture, UI, data and behaviour all live under
[`spec/`](spec/), in the precedence order [AGENTS.md](AGENTS.md) gives.

Themes inspired by Person of Interest created by Jonathan Nolan

### Browser tooling (optional)

A [Playwright MCP server](https://github.com/microsoft/playwright-mcp) is registered in
`.mcp.json` for editor-side click-through against a running stack
(`./bin/dev-start`). Acceptance tests still run only via
`./bin/test-e2e`.
