# Overseer

A single-page web console for driving CLI coding agents. `claude-code` and `cursor`
are fully wired providers — sign-in, sessions, and console; `codex`, `opencode`, and
`github-copilot` appear in the provider catalog (CLIs installed in the image; adapters
not implemented yet). Which providers exist at all is one declaration,
`providers/<id>/manifest.json`, read by the app's catalog, by the dev loop, and by the
image's install list.

Built sandboxed, with the paranoid in mind: protect the host from runaway LLMs.
Agents run in Docker, not on your desktop — they cannot wipe your home directory or
reach your real accounts. The only shared surface is `./workspace`; keep those
projects on external git remotes so a bad run is recoverable.

Architecture: [docs/architecture-design.md](docs/architecture-design.md) ·
UI: [docs/ui-ux-design.md](docs/ui-ux-design.md) ·
Behavior: [docs/overseer-behavior.md](docs/overseer-behavior.md) ·
Versioning: [docs/architecture-design.md §8](docs/architecture-design.md#8-versioning)

> **Early stage.** The UI shell, overseer wizard, provider sessions, and the raw OPEN
> CONSOLE PTY are live for `claude-code` and `cursor`. Approvals, capabilities, turn
> context, and diff rendering are not built — those windows open and say so.
> Permission requests are auto-denied. See [Status](#status).

## Requirements

- [Docker](https://docs.docker.com/get-docker/) with Compose

Nothing else. Node, npm, and the agent CLIs all live inside the container.

## This never runs on the host

Overseer and the agents it spawns always run **inside Docker**. They cannot reach
your machine except through the `./workspace` bind mount; provider auth lives in a
container volume, not your real `~/.claude`
([architecture §6](docs/architecture-design.md#6-security)).

That covers the dev loop too. `./bin/loop <workspace>` opens its session in the
same container the app runs in — same workspace, same provider registry, same
sign-in — and `loop/run` refuses to start one on the host. It is the widest tool
grant in the project, so it is the last thing that should run on your desktop.
Workspace projects whose test command is itself `docker compose` get a
Docker-in-Docker sidecar rather than a bind of your host's daemon socket.

> **Warning.** Do not start the Node server or agent CLI with host `npm` / Node —
> that skips the container entirely. `npm run dev` and `npm run dev:web` refuse
> outside Docker. Use `./bin/*` instead.

## Run (production)

```sh
./bin/start
```

Open http://127.0.0.1:3000. The compiled SPA is served by the Node server. The container
owns its own `~/.claude` in a named volume; `./workspace` is the only directory shared
with the host.

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

Three services: `deps` builds `protocol` + `claude-code` under `tsc --watch`, `server`
runs `tsx watch`, and `web` runs Vite proxying `/api` and `/ws` to `server:3000`.
`./bin/test-e2e` runs a separate `e2e` container on demand against `web:5173` on the
compose network — it brings up what it needs, so the command alone is enough.

Install dependencies with `./bin/npm install --workspace packages/web <pkg>`, never host
npm (that would write macOS binaries into a tree only ever read by Linux).
`package-lock.json` is bind-mounted, so the change lands on the host for committing.

### Browser tooling (optional)

A [Playwright MCP server](https://github.com/microsoft/playwright-mcp) is registered in
`.mcp.json` for editor-side click-through against a running stack
(`./bin/dev-start`). Acceptance tests still run only via
`./bin/test-e2e`.

## Structure

```
bin/                  docker shortcuts — the only supported way to run anything
providers/            one directory per agent CLI, read by the app and the loop alike
                      (claude-code, cursor, codex, opencode, github-copilot)
packages/
  protocol/           shared TS types — the frontend/backend/adapter contract
  web/                React + Vite + Tailwind SPA
  server/             Node: WS + REST, static SPA host, adapter registry, session supervisor
  adapters/
    claude-code/      Claude Code adapter — login, console, stream-json sessions
    cursor/           Cursor adapter — login, console, stream-json sessions
  e2e/                Playwright acceptance tests (container-only)
loop/                 the dev-loop CLI — bash, a provider CLI, and plain files
workspace/            host-shared dir — git projects live here, mounted into the container
```

## Features

- **Overseer space** — ranks what needs attention (approvals, blocked capabilities,
  sessions, usage) and each line opens the surface it refers to.
- **The overseer** — a wizard that walks a fresh instance from nothing to a working
  setup, streaming discovery into an operations window and revealing UI as capabilities
  come online. Private memory lives in `.overseer`; customization comes from the
  `overseer-personality` workspace project (advisory only).
- **Project panel** — persistent status for every project, including work outside the
  active one.
- **Sessions** — spawned, streamed, resumed, and deleted as draggable windows, not fixed
  columns. Each window's control rows list what the provider actually offers.
- **Session controls** — model, permission mode, and subagent. Model and mode retarget the
  running process (`set_model` / `set_permission_mode`); a subagent pick arms the next turn.
- **Plans** — `/plans` lists the plans the active project's sessions have produced (read
  back out of the provider's own transcripts), each with its status and a button that
  continues it in the session that built it.
- **Project creation** — a git project scaffolded into `/workspace` from the project panel.
- **Console** — raw PTY escape hatch into the provider CLI (xterm.js over `/ws`); distinct from
  stream-json agent sessions.
- **Dev loop, in-app** — `/loop` runs `loop/` in a console window; the providers window's
  loop tab sets which provider and which per-step models it uses.
- **Two themes** — samaritan (default) and machine; choice is remembered in internal memory.

Windows that exist as shape only, and say so when opened: **approvals**, **capabilities**
(and its editor), **turn context**, **diffs**. See [Status](#status).

## Status

Current milestone: **`0.2.x` — live sessions & providers**
([architecture §8.2](docs/architecture-design.md#82-milestone-map)).

In place: Docker tooling, frontend shell, and the overseer wizard. A fresh instance boots
headline-only and runs discovery over the WebSocket — scanning `/workspace` for git
projects, checking provider auth via `getStatus()`, and reading `overseer-personality` —
then mounts furniture as capabilities resolve. Details:
[docs/overseer-behavior.md](docs/overseer-behavior.md).

Two real adapters: `claude-code` and `cursor`. Both carry sign-in, auth status from the
CLI's own report, an interactive PTY console in the active project, and stream-json
sessions that spawn, stream, resume from their transcript, and can be deleted. A session
window's control rows list what that provider actually offers — models and subagents
discovered from the CLI, plus its permission modes
([architecture §1.1.1](docs/architecture-design.md)) — and each adapter declares its own
capabilities rather than inheriting `claude-code`'s. Model and permission mode change on
a session already running, through `set_model` / `set_permission_mode` control requests.

Plans are read back out of the provider's transcripts: a session run in `plan` mode leaves
an `ExitPlanMode` call carrying the plan, and `/plans` lists them under the project panel
with a derived status (`proposed`, `in-progress`, `superseded`) the operator can retire by
hand. Implementing one resumes the session that built it, leaves `plan` mode, and sends
the turn there. Each plan is also copied into internal memory, so deleting a session does
not delete the plan it produced — implementing one whose session is gone starts a fresh
session seeded with the plan. `claude-code` only — `cursor` reports no plans.

Projects can be created from the project panel. The dev loop runs inside the app: `/loop`
opens it in a console window, and the providers window's loop tab sets the loop's provider
and its per-step models, independent of the provider attached to the app.

`codex`, `opencode`, and `github-copilot` remain catalog stubs — they list in the providers
window and their CLIs ship in the image, but have no login, console, or session wiring.

Still missing — these windows open and mark themselves unavailable rather than pretending:

- **Approvals queue.** Permission requests are auto-denied with a visible error, so
  nothing ever reaches the queue.
- **Capabilities.** MCP servers, skills, and subagents are not enumerated from the
  provider; the inventory is empty and its editor neither loads nor saves.
- **Turn context.** No file, git diff, or terminal output can be attached to a turn.
- **Diff rendering.** `Edit` / `Write` tool input is not parsed into a unified diff.
- **Full adapters** for the remaining catalog stubs (`codex`, `opencode`,
  `github-copilot`).

## Versioning

The product version is the root `package.json` `version` field — currently the **live sessions &
providers** milestone ([architecture §8.2](docs/architecture-design.md#82-milestone-map)).
**`1.0.0`** waits on the §3 MVP core loop: approvals, capabilities, turn context, and diffs. Versions follow [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`): **MAJOR**
when updates break compatibility, **MINOR** when features are added safely, **PATCH** when small
bugs are fixed. Bump rules and the milestone map live in
[architecture-design.md §8](docs/architecture-design.md#8-versioning). The footer reads that field
automatically.
