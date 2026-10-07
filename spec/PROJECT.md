# Overseer

The top of the spec. When anything under `spec/` disagrees with this file, this file wins
(precedence: [AGENTS.md](../AGENTS.md)).

## Goal

A single-page web console for driving CLI coding agents — many agents, across many projects, on one
desk — **without letting them near the host**.

## Purpose

A coding agent in a terminal is powerful and, left on a developer's own machine, dangerous: it can
wipe a home directory or reach real accounts. A single terminal also shows one agent at a time.
Overseer answers both:

- **Sandbox.** Every agent runs inside Docker. In production, the only surface shared with the host is
  `/workspace`, a directory beside this repo; projects there should live on external git remotes so
  a bad run is recoverable. Development also mounts the writable source repo at `/app`,
  accessible to agent shells.
- **Harness, not replacement.** Every conversation happens in the provider CLI's own TUI, in a
  console. Overseer adds what a terminal cannot: many consoles at once that outlive the browser tab,
  one session list across every project and provider, monitoring that points at whoever is waiting,
  projects and git, provider sign-in, and an automated dev loop.
- **An instrument, not a chat app.** The interface first answers *what should I be looking at?*,
  then offers controls.

## Users

One developer, on their own local machine. There is no multi-user story and no authentication.

## Requirements

1. **Never runs on the host.** The server, the agent CLIs and the dev loop run only in the
   container; `bin/*` is the only supported entry point, and host `npm run dev` / `loop/run` refuse.
2. **Production reaches the host only through `/workspace`.** Development also shares the source repo. Provider auth lives in a container volume, never
   the operator's own `~/.<agent>`; workspace builds use a Docker-in-Docker sidecar, never the host's
   daemon socket.
3. **Local only.** The port is published on `127.0.0.1`; WebSocket upgrades check `Origin`.
   Mutating CLI hooks rely on loopback plus a per-console token and do not check `Origin`.
   Exposing it publicly is out of scope and unsafe.
4. **Every CLI feature, as the provider ships it.** Approvals, models, modes, agents, skills and plans
   are the CLI's own; Overseer does not re-implement them.
5. **Consoles belong to the server.** Closing a window detaches; a reload restores every console with
   its scrollback; killing is explicit.
6. **Provider-neutral.** A provider is a registry entry plus an adapter. `claude`, `cursor` and `codex`
   are wired for ordinary sessions. Claude and Cursor also support the dev loop; Codex does not. `opencode` and `github-copilot` remain catalog stubs whose CLIs
   ship in the image.
7. **Publishing is an explicit step.** The dev loop commits locally. `publish` accepts an
   approved/followups review artifact for that request, or an operator's `--force`; it does not
   verify a recorded sign-off or approvals for stacked ancestry. Opening a pull request is the
   operator's job.
8. **Signals over interruptions.** Escalations become ranked, actionable signals in the overseer space.
   No toasts or modals, except the one blocking decision for actions that cannot be undone.

## Non-goals

- Authentication, multi-user, or hosting as a public service.
- Replacing a provider CLI's UI with Overseer's own chat (removed in `0.5.0`).
- Viewports narrower than 1024px.
- Running anything outside Docker.

## Where the rest lives

| Concern | File |
|---|---|
| Vocabulary and invariants | [domain.md](domain.md) |
| Components, contracts, container, security, versioning | [architecture.md](architecture.md) |
| Look, feel, layout, anti-patterns | [ui-ux.md](ui-ux.md) |
| Stores, formats, contracts | [data.md](data.md) |
| The overseer's voice, wizard and memory | [behaviour/overseer.md](behaviour/overseer.md) |
| Consoles and sessions | [behaviour/consoles.md](behaviour/consoles.md) |
| Callsigns and relay | [behaviour/relay.md](behaviour/relay.md) |
| The dev loop | [behaviour/dev-loop.md](behaviour/dev-loop.md) |
| Changes to this spec | [decisions/](decisions/) |
| How to test and verify | [tests.md](tests.md) |

Operator-facing usage is the [README](../README.md); release notes are [CHANGELOG.md](../CHANGELOG.md).
