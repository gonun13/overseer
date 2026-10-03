# Data — Contracts, Models and Persistence

Where state lives, what shape it has, and which code is the contract for it. Components are in
[architecture.md](architecture.md); what the overseer *does* with its memory is in
[behaviour/overseer.md §6](behaviour/overseer.md#6-memory).

---

## 1. Where things live

One container runs the app and the loop, and the split between what an image
rebuild replaces and what survives it is load-bearing:

| Path | What | Persistence |
|---|---|---|
| `/app` | code — `packages/`, `loop/`, `providers/` | image; a bind mount of the repo in dev |
| `/home/overseer` | every provider CLI's config and auth, plus the git ssh key ([architecture.md §2.2](architecture.md#22-git-access)) | the `agent-home` volume |
| `/workspace` | the production surface shared with the host | host bind mount, from `OVERSEER_WORKSPACE_HOST` |
| `/workspace/<project>/` | one git project per directory; a console's `cwd` | host |
| `/app` (dev only) | writable source repo, accessible to agent shells | host bind mount |
| `/app/.overseer` | internal memory (§2) | the `overseer-memory` volume |
| `/app/loop/db` | the dev loop's file store ([behaviour/dev-loop.md](behaviour/dev-loop.md)) | the repo in dev, the `loop-db` volume in prod |

`OVERSEER_WORKSPACE_HOST` is the one path the image cannot state, because it names a
directory on the *host* — where the operator keeps their projects. It is read by `bin/*`
and by Compose, never by the container, which knows only `/workspace`. It defaults to
`../overseer-workspace`, a sibling of the repo: inside the repo, the dev stack's `.:/app`
mount made every project reachable a second time as `/app/workspace/<name>`, a path
`isInsideWorkspace` rejects, and put the operator's work inside the tree that `bin/reset`
and a stray `git clean` operate on. `bin/*` creates it at the caller's uid before the
first compose call — a bare `docker compose` gets the default but not that, which is one
more reason `bin/` is the only supported way to run anything ([architecture.md §1](architecture.md#1-architecture)).

**Nothing that an image rebuild must be able to replace may live under
`/home/overseer`.** A named volume mounts there and shadows the image's copy
from the first mount onward, so anything baked in is frozen at that moment. It
is why Cursor's bundle is installed to `/opt` and symlinked onto `PATH` rather
than left where its installer puts it, under `$HOME`.

One volume for every provider rather than one per provider is deliberate:
adding a provider should not mean editing two compose files, and a CLI that
invents its own config path still persists. The cost is that `agent-home` holds
every provider's token at once — the exposure [architecture.md §6](architecture.md#6-security)
names.

The container runs as the host user's uid/gid (`OVERSEER_UID`/`OVERSEER_GID`,
filled by `bin/_lib.sh` from `id`). Without that, bind mounts owned by any user
other than 1000 are unwritable and git refuses the workspace as dubiously owned.

`/workspace` and `/app/loop/db` are also mounted into the `dind` sidecar at the same absolute
paths, or a workspace project's own bind mounts resolve to empty directories
([architecture.md §6.3](architecture.md#63-the-daemon-that-builds-workspace-projects)).

What discards what: `./bin/reset` drops every volume, auth included; `reset overseer` in settings
removes `state.json`, `actions.jsonl`, run logs and `personality.json`. A legacy `plans.json`, if
present from an older build, survives ([behaviour/overseer.md §6.5](behaviour/overseer.md#65-resetting-the-overseer--forgetting-on-purpose)).

---

## 2. Internal memory — `/app/.overseer`

Container-owned, not exposed through the workspace bind, and never accepted as a workspace path.
The server owns all access, in `packages/server/src/memory/internal.ts`.

```
.overseer/
  logs/<run>.jsonl   structured operation log — one file per run (discovery, wizard, later runs)
  actions.jsonl      append-only action register
  state.json         last-known world snapshot
```

| Store | Shape (`internal.ts`) | Rule |
|---|---|---|
| `actions.jsonl` | `ActionRecord` — `at`, `actor` (`overseer` \| `operator`), `action`, `outcome` (`ok` \| `blocked` \| `failed` \| `skipped`), optional `detail` | A report starts a best-effort asynchronous append, then broadcasts without waiting. Never filtered or muted by configuration. |
| `state.json` | `WorldSnapshot` — `at`, `runCount`, `workspaceRoot`, `projects`, `providers`, `last_active_project?`, `attached_provider?`, `theme?`, `git_identity?` | Its existence is what makes a boot a return visit. Restore `attached_provider` when registered; otherwise attach the first authenticated provider. |
| `logs/` | one JSONL file per run id | Records, not screen content; the status window shows derived rows. |

A usage-history / session / search index (`index.sqlite`) was planned in earlier drafts and does
not exist; the session list is rebuilt in memory from transcripts (§3).

## 3. Provider transcripts

Owned by each CLI, read by its adapter only to **list** sessions — id, title, branch, timestamps —
and to delete one. Overseer never replays a transcript: the CLI does that itself on `--resume`,
in its own console. The formats are undocumented and may drift, which is one more reason to read
as little of them as possible; every read lives in the adapter package.

Claude: `$CLAUDE_CONFIG_DIR/projects/<cwd-slug>/<session-uuid>.jsonl`, one JSON object per line.
Observed shapes:

- **Message records:** `type`, `uuid`, `parentUuid`, `sessionId`, `timestamp`, `message`, `cwd`,
  `gitBranch`, `version`, `userType`, `promptId`, `isMeta`, `isSidechain`.
- **Operation records:** `type`, `operation`, `sessionId`, `timestamp` (compaction and similar).

Cursor: read by `packages/adapters/cursor/src` (`transcripts` tests pin the observed shape).

## 4. Contracts

The TypeScript in `packages/protocol/src` **is** the contract between web, server and adapters.
This spec does not restate its types; change the type, and the compiler finds every consumer.

| Contract | Source of truth | Notes |
|---|---|---|
| WebSocket frames (`/ws`) | `protocol/src/wire.ts` | Discriminated union on `type`, namespaced `project.*`, `console.*`, `git.*`, `loop.*`, `auth.*`, `session.*`, `operator.*`, `provider.*`, `theme.*`, `memory.*`, `workspace.*`, `discovery.*`, plus `connected` and `error`. Almost all app traffic goes here. |
| Adapter runtime | `protocol/src/adapter.ts` | `AgentAdapter`, `AdapterStatus`, capabilities — see [architecture.md §1.1](architecture.md#11-the-adapter-interface). |
| Activity vocabulary | `protocol/src/space.ts` (`Activity`) | The six values in [ui-ux.md §3](ui-ux.md#3-activity--the-one-status-vocabulary). |
| Discovery events | `protocol/src/discovery.ts` | |
| HTTP | `packages/server/src/index.ts` | `GET /api/health`; `POST /hooks/<console>/<token>` (loopback only, per-console token — [architecture.md §6.1](architecture.md#61-approvals-and-hooks)); the built SPA. |
| Provider manifest | `providers/<id>/manifest.json` | `id`, `cli`, `configDir`, `install`, `app` (`adapter` \| `stub` \| `none`), `loop` (`bundle` \| `none`), optional `loopSubagents` — [architecture.md §1.1.2](architecture.md#112-the-provider-registry). |
| `personality.json` | `packages/server/src/memory/personality/` | Allowlisted fields only — [behaviour/overseer.md §6.4](behaviour/overseer.md#64-the-customization-boundary). |
| Dev-loop store | `loop/bin/lib/db.sh` (`LOOP_STEPS`) | `db/<slug>/<step>/<id>.md`, `index.jsonl`, `memory.md`, `implement.lock`, branch metadata in the project's `.git/config` — [behaviour/dev-loop.md](behaviour/dev-loop.md) (file taxonomy, the train). |
| Changelog | `CHANGELOG.md` parsed by `packages/web/src/changelog.ts` | Heading format is a contract — [architecture.md §8.4](architecture.md#84-changelog). |

## 5. Browser storage

Only one thing persists in the browser: console window state (ids, opening order and geometry;
restore uses the ids/order and tiles the windows)
(`packages/web/src/state/console-layout.ts`, `localStorage`, best effort). Everything else the
operator chooses — theme, active project, attached provider, git identity — lives server-side in
`state.json`, so it survives a different browser.

## 6. Runtime overrides

These are container environment variables; adding them to Compose's `.env` alone does not
forward them to a service. Defaults apply when unset.

| Variable | Effect / default |
|---|---|
| `SHELL` | Plain console executable, `bash`; always receives `-l`. |
| `OVERSEER_LOOP_DB` | Server loop lease/session record directory, `/app/loop/db`; does not move the shell helpers' store. |
| `OVERSEER_LOOP_BIN_MODELS` | Model configuration helper, `/app/loop/bin/models`. |
| `OVERSEER_LOOP_BIN_PROVIDER` | Provider selection helper, `/app/loop/bin/provider`. |
| `OVERSEER_SSH_DIR` | SSH key store, `$HOME/.ssh`. |
| `XDG_CONFIG_HOME` | Cursor's first token lookup is `<value>/cursor/auth.json`; empty/unset uses `$HOME/.config/cursor/auth.json`, then the legacy locations. |
| `CURSOR_API_ENDPOINT` | Cursor dashboard API base, `https://api2.cursor.sh`; blank uses the default, trailing slashes are stripped. |
