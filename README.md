# Overseer

A single-page web console for driving CLI coding agents. Claude Code is the first adapter.

Built sandboxed, with the paranoid in mind: protect the host from runaway LLMs.
Agents run in Docker, not on your desktop — they cannot wipe your home directory or
reach your real accounts. The only shared surface is `./workspace`; keep those
projects on external git remotes so a bad run is recoverable.

Architecture: [docs/architecture-design.md](docs/architecture-design.md) ·
UI: [docs/ui-ux-design.md](docs/ui-ux-design.md) ·
Behavior: [docs/overseer-behavior.md](docs/overseer-behavior.md) ·
Versioning: [docs/architecture-design.md §8](docs/architecture-design.md#8-versioning)

> **Early stage.** The UI shell and overseer wizard are live. Session spawning for the
> `claude-code` adapter is not implemented yet — there are no live agent sessions or
> transcripts. See [Status](#status).

## Requirements

- [Docker](https://docs.docker.com/get-docker/) with Compose

Nothing else. Node, npm, and the agent CLI all live inside the container.

## This never runs on the host

Overseer and the agents it spawns always run **inside Docker**. They cannot reach
your machine except through the `./workspace` bind mount; Claude auth lives in a
container volume, not your real `~/.claude`
([architecture §6](docs/architecture-design.md#6-security)).

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
| `./bin/dev-start`  | Start the dev stack against real state (`-d` to detach, `--build` to rebuild) |
| `./bin/dev-stop`   | Stop it; volumes survive                                                     |
| `./bin/mock-start` | Dev stack with design fixtures instead of real state                         |
| `./bin/mock-stop`  | Same as `./bin/dev-stop`                                                     |
| `./bin/start`      | Build and run the production stack                                           |
| `./bin/stop`       | Stop the production stack                                                    |
| `./bin/logs [svc]` | Follow dev stack logs (`deps`, `server`, `web`)                              |
| `./bin/sh [svc]`   | Shell into a dev container (defaults to `server`)                            |
| `./bin/npm <args>` | Run npm inside the dev container — use for **all** dependency work           |
| `./bin/check`      | Typecheck + lint                                                             |
| `./bin/test-e2e`   | Playwright acceptance tests (args pass through to `playwright test`)         |
| `./bin/reset`      | Tear down the dev stack and discard volumes, including agent auth            |

Three services: `deps` builds `protocol` + `claude-code` under `tsc --watch`, `server`
runs `tsx watch`, and `web` runs Vite proxying `/api` and `/ws` to `server:3000`.
`./bin/test-e2e` runs a separate `e2e` container on demand against `web:5173` on the
compose network — it brings up what it needs, so the command alone is enough.

Install dependencies with `./bin/npm install --workspace packages/web <pkg>`, never host
npm (that would write macOS binaries into a tree only ever read by Linux).
`package-lock.json` is bind-mounted, so the change lands on the host for committing.

### Wireframe fixtures

Some windows still use static fixtures in `packages/web/src/data/mock.ts` (sessions,
approvals, capability editor, context, console, diff). They load only when
`VITE_OVERSEER_WIREFRAME=1`, which `./bin/mock-start` sets. Production and
`./bin/dev-start` leave it unset, so fixtures do not ship.

The overseer path (headline, signals, wizard, operations window) never reads those
fixtures — it uses real server state or an explicit empty readout.

### Browser tooling (optional)

A [Playwright MCP server](https://github.com/microsoft/playwright-mcp) is registered in
`.mcp.json` for editor-side click-through against a running stack
(`./bin/dev-start` or `./bin/mock-start`). Acceptance tests still run only via
`./bin/test-e2e`.

## Structure

```
bin/                  docker shortcuts — the only supported way to run anything
packages/
  protocol/           shared TS types — the frontend/backend/adapter contract
  web/                React + Vite + Tailwind SPA
  server/             Node: WS + REST, static SPA host, adapter registry
  adapters/
    claude-code/      Claude Code adapter (session spawning not implemented yet)
  e2e/                Playwright acceptance tests (container-only)
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
- **Sessions, approvals, diffs** — summoned as draggable windows, not fixed columns.
- **Capabilities** — MCP servers, skills, and subagents, with an editor for instructions,
  model, and tool grants.
- **Console** — raw escape hatch into the adapter CLI (currently a mockup that echoes).
- **Prompt controls** — model, permission mode, subagent, and context, armed before the
  next turn.
- **Two themes** — samaritan (default) and machine.

## Status

In place: Docker tooling, frontend shell, and the overseer wizard. A fresh instance boots
headline-only and runs discovery over the WebSocket — scanning `/workspace` for git
projects, checking adapter auth via `getStatus()`, and reading `overseer-personality` —
then mounts furniture as capabilities resolve. Details:
[docs/overseer-behavior.md](docs/overseer-behavior.md).

Still missing:

- `claude-code` process spawning ([architecture §1.2](docs/architecture-design.md))
  — no live sessions or transcripts yet
- Auth check reads the credentials file rather than validating a token
- Console is a mockup (echoes; no PTY)

## Versioning

Current release: **0.1.1** — the **overseer shell** milestone
([overseer-behavior.md](docs/overseer-behavior.md)). **`1.0.0`** waits on the §3 MVP core loop
([architecture-design.md §8](docs/architecture-design.md#8-versioning)).

Bump rules, monorepo lockstep, release checklist, and the full milestone map live in
[architecture-design.md §8](docs/architecture-design.md#8-versioning). The footer reads the root
version from `package.json` automatically.
