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
./bin/dev
```

Vite on http://127.0.0.1:5173 with hot reload, API server on http://127.0.0.1:3000. Edit files on
the host as usual — the source tree is bind-mounted and watched.

| Command            | What it does                                                         |
| ------------------ | -------------------------------------------------------------------- |
| `./bin/dev`        | start the dev stack (add `-d` to detach, `--build` to force rebuild) |
| `./bin/stop`       | stop it; volumes survive                                             |
| `./bin/logs [svc]` | follow logs (`deps`, `server`, `web`)                                |
| `./bin/sh [svc]`   | shell into a container (defaults to `server`)                        |
| `./bin/npm <args>` | run npm inside the container — use this for **all** dependency work  |
| `./bin/check`      | typecheck + lint                                                     |
| `./bin/up`         | build and run the production stack                                   |
| `./bin/reset`      | tear down and discard volumes, including agent auth                  |

Three services: `deps` builds `protocol` + the adapters and holds them in `tsc --watch` (`server`
and `web` import them through `dist/`, so compose gates both on it), `server` runs `tsx watch`, and
`web` runs Vite proxying `/api` and `/ws` to `server:3000`.

### Wireframe fixtures

The shell is designed against static fixtures in `packages/web/src/data/mock.ts`, since the WS event
pipe that would feed it live state does not exist yet (see Status). They are a design-development
device and they do not ship: they load only when `VITE_OVERSEER_WIREFRAME=1`, which the dev stack
sets and the production image never does. Vite inlines the variable at build time, so `./bin/up`
drops the fixtures from the bundle rather than shipping them unused.

Everything an instance learns at runtime lives there, not only the obviously fake rows — the model
and subagent lists, the prompt's starting settings, the workspace paths, the adapter's own name. A
plausible default is invented data too, so the blank side of each pair is empty and the UI reports
that it has not been told rather than filling the gap in.

To see the dev stack as a fresh instance instead — no projects, sessions, approvals or capabilities:

```
VITE_OVERSEER_WIREFRAME=0 ./bin/dev
```

That is the same state `./bin/up` serves today.

Install a dependency with `./bin/npm install --workspace packages/web <pkg>` — never with host npm,
which would write macOS binaries into a tree only ever read by Linux. `package-lock.json` is
bind-mounted, so the change lands on the host for committing.

## Run it (production)

```
./bin/up
```

Serves the compiled SPA from the Node server at http://127.0.0.1:3000 — no bind-mounted source, no
watchers. The container owns its own `~/.claude` in a named volume; `./workspace` is the only
directory shared with the host.

## Features

- **Overseer space** — the centre of the screen ranks what needs attention (approvals, blocked
  capabilities, running and finished sessions, usage pressure) and every line opens the window,
  panel or control it refers to. Derived on every render, so it cannot go stale.
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

Docker setup, tooling, and the frontend shell are in place with placeholder data. The shell is a
fixed field of instruments — project panel, active project, clock and settings, prompt controls,
adapter widget — around the overseer space. Windows are summoned, dragged and dismissed rather than
laid out.

The adapter interface and protocol types exist; the `claude-code` adapter's actual process-spawning
(design doc §1.2) and the WS event pipe that would replace the mock data are not implemented yet.
The console is a mockup — it echoes rather than attaching to a pty.
