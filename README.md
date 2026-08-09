# Overseer

A single-page web console for driving CLI coding agents. Claude Code is the first adapter.

See [docs/claude-code-webui-design.md](docs/claude-code-webui-design.md) for the architecture and
[docs/design-system.md](docs/design-system.md) for the visual language.

## Structure

```
packages/
  protocol/           shared TS types — the frontend/backend/adapter contract
  web/                React + Vite + Tailwind SPA
  server/              Node: WS + REST, static SPA host, adapter registry
  adapters/
    claude-code/      spawns `claude`, normalizes stream-json → protocol (stub)
    mock/             replays recorded fixtures; no CLI, no auth needed (stub)
workspace/            host-shared dir — git projects live here, mounted into the container
```

## Run it (Docker)

```
docker compose up --build
```

Serves the app at http://127.0.0.1:3000. The container owns its own `~/.claude` in a named
volume; `./workspace` is the only directory shared with the host.

## Develop locally

Requires Node 22+.

```
npm install
npm run build        # protocol + adapters must build before server/web can consume them
npm run dev:web       # Vite dev server on :5173, proxies /api and /ws to :3000
npm run dev            # server on :3000 (in a second terminal)
```

Other scripts: `npm run typecheck`, `npm run lint`, `npm run format`.

## Status

Docker setup, tooling, and the frontend shell (top bar, nav rail, all five zones per the design
system, machine/samaritan themes) are in place with placeholder data. The adapter interface and
protocol types exist; the `claude-code` adapter's actual process-spawning (design doc §1.2) is not
implemented yet.
