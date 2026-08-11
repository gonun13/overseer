# Overseer

A single-page web console for driving CLI coding agents. Claude Code is the first adapter.

See [docs/claude-code-webui-design.md](docs/claude-code-webui-design.md) for the architecture,
[docs/design-system.md](docs/design-system.md) for the visual language, and
[docs/overseer.md](docs/overseer.md) for the overseer's behavior — what it says, when it says it, and the
memory precedence model behind it.

## Structure

```
bin/                  docker shortcuts — the only supported way to run anything
packages/
  protocol/           shared TS types — the frontend/backend/adapter contract
  web/                React + Vite + Tailwind SPA
  server/              Node: WS + REST, static SPA host, adapter registry
  adapters/
    claude-code/      spawns `claude`, normalizes stream-json → protocol (stub)
    mock/             replays recorded fixtures; no CLI, no auth needed (stub)
workspace/            host-shared dir — git projects live here, mounted into the container
```

## This never runs on the host

Not in production, not in development, not "just the frontend". The server spawns coding agents
with filesystem and network access — the container _is_ the security model (design doc §6). A host
run puts your real `~/.claude`, your home directory, and every repo on the machine inside the blast
radius, and Node being installed locally is not permission to use it.

`npm run dev` and `npm run dev:web` are wired to refuse on the host. Everything below goes through
Docker; you need nothing installed except Docker.

## Develop

```
./bin/dev-start
```

Vite on http://127.0.0.1:5173 with hot reload, API server on http://127.0.0.1:3000. Edit files on
the host as usual — the source tree is bind-mounted and watched.

| Command             | What it does                                                             |
| -------------------- | ------------------------------------------------------------------------- |
| `./bin/dev-start`  | start the dev stack against real state (`-d` to detach, `--build` to force rebuild) |
| `./bin/dev-stop`   | stop it; volumes survive                                                  |
| `./bin/mock-start` | start the dev stack loaded with design fixtures instead of real state     |
| `./bin/mock-stop`  | stop it — same containers as `dev-start`, so identical to `./bin/dev-stop` |
| `./bin/start`      | build and run the production stack                                        |
| `./bin/stop`       | stop the production stack                                                 |
| `./bin/logs [svc]` | follow dev stack logs (`deps`, `server`, `web`)                           |
| `./bin/sh [svc]`   | shell into a dev container (defaults to `server`)                        |
| `./bin/npm <args>` | run npm inside the dev container — use this for **all** dependency work   |
| `./bin/check`      | typecheck + lint                                                          |
| `./bin/test-e2e`   | Playwright acceptance tests against the dev stack (args pass through to `playwright test`) |
| `./bin/reset`      | tear down the dev stack and discard volumes, including agent auth         |

Three services: `deps` builds `protocol` + the adapters and holds them in `tsc --watch` (`server`
and `web` import them through `dist/`, so compose gates both on it), `server` runs `tsx watch`, and
`web` runs Vite proxying `/api` and `/ws` to `server:3000`. A fourth, `e2e`, is not part of the
stack — `./bin/test-e2e` runs it on demand, and it reaches `web:5173` over the compose network
rather than the host.

Tests are no exception to the rule above: `packages/e2e` runs inside its own container, off a
`test` image that is the `dev` one plus Chromium, so `./bin/dev-start` never pays for the browser
download. It brings up whatever it needs, so `./bin/test-e2e` on its own is enough.

For manual browser checks, the [Playwright MCP server](https://github.com/microsoft/playwright-mcp)
is registered project-wide in `.mcp.json`, so Claude Code picks it up automatically in this repo
with nothing to re-register per session. It is a generic tool driving a browser on the host, not
this app running there — start the stack first (`./bin/dev-start` or `./bin/mock-start`) so
`127.0.0.1:5173` and `:3000` are live, then Claude can click through the running instance directly
instead of writing one-off Playwright scripts.

### Wireframe fixtures

Several windows are still designed against static fixtures in `packages/web/src/data/mock.ts` —
sessions, approvals, the capability editor, context, console and diff. They are a
design-development device and they do not ship: they load only when `VITE_OVERSEER_WIREFRAME=1`,
which `./bin/mock-start` sets and nothing else does — `./bin/dev-start` and the production image
both leave it unset. Vite inlines the variable at build time, so `./bin/start` drops the fixtures
from the bundle rather than shipping them unused.

**The overseer's own path does not use them.** The headline, signals, wizard state and the
operations window are computed from real server state or an explicit "not known yet" — no module in
that path imports `data/mock.ts`. Shared UI shapes live in `packages/web/src/domain.ts`, so
importing a type never drags the fixtures along with it.

Everything an instance learns at runtime lives there, not only the obviously fake rows — the model
and subagent lists, the prompt's starting settings, the workspace paths, the adapter's own name. A
plausible default is invented data too, so the blank side of each pair is empty and the UI reports
that it has not been told rather than filling the gap in.

`./bin/dev-start` already gives you a fresh instance — no projects, sessions, approvals or
capabilities, same as production. Use `./bin/mock-start` instead to preview the fixtures.

Install a dependency with `./bin/npm install --workspace packages/web <pkg>` — never with host npm,
which would write macOS binaries into a tree only ever read by Linux. `package-lock.json` is
bind-mounted, so the change lands on the host for committing.

## Run it (production)

```
./bin/start
```

Serves the compiled SPA from the Node server at http://127.0.0.1:3000 — no bind-mounted source, no
watchers. The container owns its own `~/.claude` in a named volume; `./workspace` is the only
directory shared with the host.

## Features

- **Overseer space** — the centre of the screen ranks what needs attention (approvals, blocked
  capabilities, running and finished sessions, usage pressure) and every line opens the window,
  panel or control it refers to. Derived on every render, so it cannot go stale.
- **The overseer** — a wizard that walks a fresh instance from nothing to a working setup,
  reporting each discovery step in its own operations window and revealing furniture as each
  capability comes online. It keeps a private record in `.overseer` and reads customization from
  `overseer-personality`, a normal workspace project — advisory only, filtered through an internal
  allowlist, with anything refused reported back as a signal.
- **Project panel** — a persistent status list of every project, with a status light each, so work
  happening outside the active project is still visible.
- **Sessions, approvals, diffs** — summoned as draggable windows rather than laid out in fixed
  columns.
- **Capabilities** — MCP servers, skills and subagents, with an editor for a skill's or subagent's
  instructions, model and tool grants.
- **Console** — a raw terminal into the adapter's CLI for operators who already know it: its own
  slash commands, its own errors, verbatim. The escape hatch for anything the considered views
  don't cover. Open it from the footer or type `console`.
- **Prompt controls** — model, permission mode, subagent and attached context, armed before the
  next turn and reachable with bare number keys.
- **Two themes** — samaritan (default) and machine, its inversion at every level.

## Status

Docker setup, tooling and the frontend shell are in place. The shell is a field of instruments —
project panel, active project, clock and settings, prompt controls, adapter widget — around the
overseer space, and windows are summoned, dragged and dismissed rather than laid out.

The overseer is live: a fresh instance boots headline-only and works through a wizard
(`state/wizard.ts`) that runs a real discovery pass over the WS — scanning `/workspace` for git
projects, checking each adapter's auth via `getStatus()`, and reading `overseer-personality` —
streaming each step into the operations window and mounting furniture as capabilities resolve. It
keeps internal memory in `.overseer` on a container-only volume. See
[docs/overseer.md](docs/overseer.md).

Still missing: the `claude-code` adapter's process-spawning (design doc §1.2), so there are no
sessions and no transcript, and the auth check reads the credentials file rather than validating a
token. The console is a mockup — it echoes rather than attaching to a pty.
