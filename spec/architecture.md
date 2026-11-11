# Architecture

Structure, components, boundaries and interfaces. Purpose and requirements are in [PROJECT.md](PROJECT.md); stores and formats in [data.md](data.md); operator-visible flows in [behaviour/](behaviour/).

**What it is:** a single-page, fullscreen web console for driving CLI coding agents. `claude`, `cursor`, `codex` and `opencode` are wired for sessions; Claude, Cursor and opencode also support the dev loop. The registry can still list a catalog stub (`app: "stub"`) whose CLI ships in the image before its adapter does; none does today.

**Shape:** one Docker container holds the agent CLIs, their state, and the web server. In production the only bind mount is the workspace — a directory *outside* this repo, containing git projects. Development also binds the writable source repo at `/app`, accessible to agent shells. Auth and application state live in container-owned volumes.

**Aesthetic:** a surveillance console, not a chat app — dense, monospace, border-only chrome, one focus zone at a time. See [ui-ux.md](ui-ux.md).

---

## 1. Architecture

```
bin/                  docker shortcuts — the only supported way to run anything
providers/            one directory per agent CLI, read by the app and the loop alike
                      (claude, cursor, codex, opencode)
packages/
  protocol/           shared TS types — the frontend/backend/adapter contract
  web/                React + Vite + Tailwind SPA
  server/             Node: WS + REST, static SPA host, adapter registry, console registry,
                      session index, CLI hook endpoint
  adapters/
    claude/      Claude Code adapter — login, usage, console command line + hooks, transcripts
    codex/       Codex adapter — ChatGPT device login, subscription quotas, native threads and TUI
    cursor/           Cursor adapter — login, usage, console command line, transcripts
    opencode/    opencode adapter — readiness, prepared sessions, TUI plugin for hooks
  e2e/                Playwright acceptance tests (container-only)
loop/                 the dev-loop CLI — bash, a provider CLI, and plain files
                      the workspace is not in here — it is a host directory beside the repo
                      (OVERSEER_WORKSPACE_HOST, data.md §1), mounted at /workspace
```

**A harness, not a replacement.** Every agent interaction happens in the provider's own CLI, running in a PTY the server owns and the browser shows through xterm.js (§1.2). Overseer does not re-implement what the CLIs already do — transcripts, approvals, models, agents, skills, plans are all the CLI's own. What it adds is the desk around them: many consoles across many projects at once, a session list across all of them, monitoring, projects, git, auth and the dev loop. Adapters translate the few provider-specific things that remain — how to log in, how to read usage, what command line starts or resumes a session, where transcripts live — into `protocol/`. Catalog stubs live in the server registry (`stub-adapters.ts`) until they earn a real `packages/adapters/<id>/` package.

**Provider vs adapter.** Two words for the two sides of the same id string (`"claude"`, `"codex"`, …):

| Term         | Layer            | Where it appears                                                                                                              |
| ------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **provider** | operator/product | what the operator attaches, signs in and configures — the provider widget and window, `provider.connect` |
| **adapter**  | internal runtime | the code that translates a CLI into `protocol/` — `AgentAdapter` (§1.1), `packages/adapters/`, the server's adapter registry   |

One provider is attached at a time, and it is backed by exactly one adapter.

### 1.1 The adapter interface

```typescript
interface AgentAdapter {
  id: string; // "claude"
  capabilities: AdapterCapabilities; // { login, usageCheck }
  getStatus(): Promise<AdapterStatus>;
  refreshUsage?(): Promise<AdapterStatus>;
  checkUsage?(opts: { projectDir: string }): Promise<AdapterUsageCheck>;
  login?: AdapterLogin;
  // The command line for an interactive console. The server owns the PTY;
  // the adapter only knows its CLI's flags.
  consoleCommand?(opts: ConsoleOpts): Promise<ConsoleCommand>;
  sessionsWatchPath?(): string | undefined;
  sessions?: AdapterSessionStore; // list, title, delete transcripts; mint ids
}

interface ConsoleOpts {
  cwd: string;
  sessionId?: string; // with resume: the session to pick up; without: an id to adopt
  resume?: boolean;
  prompt?: string; // opening prompt, as the CLI's positional argument
  hookUrl?: string; // where lifecycle hooks report (§1.2)
}
```

Adding a provider is mostly a command line: an adapter that can say how to start and resume its
CLI gets consoles, and one that can list its transcripts gets the session list.

### 1.1.2 The provider registry

`providers/<id>/` is the one declaration of what a provider is, read by both
sides of this repo. A directory carries `manifest.json`, and — when the loop can
open a session on it — `provider.sh` plus that provider's own config tree.

```json
{
  "id": "claude",
  "cli": "claude",
  "configDir": ".claude",
  "install": { "kind": "npm", "spec": "@anthropic-ai/claude-code@2.1.308" },
  "app": "adapter",
  "loop": "bundle"
}
```

A provider can be implemented on one side, the other, or both, which is what the
two role fields say. `app` is `adapter` when this server has real wiring,
`stub` when the CLI is in the image but sessions/auth/console are not built yet,
`none` when the app should not list it at all. `loop` is `bundle` when the
directory carries `provider.sh`, `none` otherwise. `claude` and `cursor`
are both `adapter`/`bundle` today: the loop runs on either and the app has real
wiring for either. `loopSubagents: "unverified"` on `cursor` means the loop's
delegation to subagents has not been confirmed. The app exposes login and usage checking,
not subagent file management. `opencode` is `adapter`/`bundle` with `loopSubagents:
"unverified"` too; its bundle and adapter are described in §2 and
[behaviour/dev-loop.md](behaviour/dev-loop.md). Codex is `adapter`/`none`: ordinary sessions are implemented,
while dev-loop support and API-key entry are excluded. Its CLI is pinned to `0.163.0`.
Consoles launch it with `check_for_update_on_startup=false`, as Claude's run with its
autoupdater disabled: the npm prefix is root-owned, so an in-TUI update could only fail, and a
version bump goes through the manifest pin.

Three consumers, no duplication between them:

| Consumer | Reads | For |
|---|---|---|
| `packages/server/src/provider-registry.ts` | every manifest | the adapter catalog — `adapter` gets its real implementation, `stub` gets a catalog-only adapter |
| `loop/bin/lib/providers.sh` | manifests with `loop: "bundle"` | which bundles a session can be opened on |
| `Dockerfile` (stage `agents`) | `install` | which CLIs the image carries |

The Dockerfile is the one that cannot read JSON at build time without becoming
unreadable, so it is kept in step by a lint rather than by generation:
`loop/bin/check-providers` requires a `# provider-cli: <id>` marker and the
literal spec or URL for every manifest with a non-null `install`, and fails on a
marker no manifest backs. Adding a provider is a directory plus one line in the
image.

Where the registry lives is a deployment fact, `OVERSEER_PROVIDERS_DIR`, for the
same reason `CLAUDE_CONFIG_DIR` and the workspace root are.

### 1.2 Process model — consoles belong to the server

Every CLI process runs in a PTY owned by the server's console registry
(`packages/server/src/console-registry.ts`), never by a browser tab:

- **Kinds.** `agent` (the provider CLI, via `consoleCommand`), `shell` (a login shell in the
  project) and `loop` (`/app/loop/run <project>`). All three go through one spawn helper
  (`pty.ts`).
- **Attach, don't own.** A socket *attaches* to a console — it is sent the scrollback (a 512 × 1024 UTF-16 code-unit
  ring), then live output — and *detaches* when its window closes or the tab goes away. The
  process keeps running until it exits or someone kills it. Resize is last-writer-wins.
- **One CLI per transcript.** Opening an agent console on a session that already has a running
  console attaches to that console instead of starting a second CLI on the same JSONL. A session
  a live dev-loop run holds is refused; its loop console is the way in. A project's loop console
  is likewise attached rather than started twice.
- **Ids are minted up front.** A new session gets an id from `sessions.mintSessionId({ projectDir, prompt? })` and passes
  it to the CLI (claude `--session-id`, cursor `--resume`, which adopts an unseen id), so the
  console and its transcript are linked from the first byte. Codex creates a native thread in
  that directory and names it from the opening prompt, or `new session`, to persist it before
  closing App Server and launching `codex resume <id>`. opencode cannot adopt an id either: a
  short-lived `opencode serve` creates an empty session in the project, and the TUI opens it with
  `--session <id>`; its own `--prompt` is ignored beside `--session`, so the opening prompt is
  sent into the empty session by Overseer's plugin (below). Failed preparation refuses the open;
  failed spawning deletes the newly prepared thread or session. Resumes preserve the id and
  callsign.
- **Exited consoles stay listed** until dismissed, so a failure can still be read.
- **Consoles die with the server.** The registry is in memory and every PTY is its child, so a
  server crash ends every console. The production stack restarts the service
  (`restart: unless-stopped`) and health-checks `GET /api/health`; a wedged server shows as
  `unhealthy` in `docker compose ps` but is not restarted for it.
- **Activity.** Claude Code consoles are started with a `--settings` layer of hooks
  (`SessionStart`, `UserPromptSubmit`, `Pre/PostToolUse`, `Notification` on permission prompts,
  `Stop`) that `curl` the server's loopback-only `POST /hooks/<console>/<token>?activity=…`. The
  per-console token means only the CLI the server spawned can report for it. opencode consoles
  load a plugin from the adapter's build (named in `OPENCODE_CONFIG_CONTENT`, which merges with
  the operator's own config) that posts the same endpoint from the CLI's events: a session going
  busy is `working`, idle is `idle`, and a permission or question prompt — a subagent's included —
  is `waiting`. The same plugin appends the relay brief to the system prompt. A CLI without hooks
  is read from its output: output means `working`, two quiet seconds mean `idle`.
- **Relay.** Activity is also what gates a relay: `relay.ts` types a queued prompt into an agent
  console only on an idle transition with no operator draft ([behaviour/relay.md](behaviour/relay.md)).

The session list (`session-index.ts`) is a separate index: every adapter's transcripts
in every workspace project, rebuilt whenever a transcript changes (`transcript-monitor.ts`) and
broadcast to every tab. The browser joins it with the console list to light each session.
Building it also removes finished loop transcripts and updates their loop session records.

What the operator sees of all this — opening, attaching, detaching, killing, a reload — is
[behaviour/consoles.md](behaviour/consoles.md).

---

## 2. Auth & Config

The container owns the agent's home in a named volume, `agent-home` — every provider CLI's config and auth, not Claude's alone (§6.2). Host config is never mounted.

**Login from the frontend.** The providers window runs `claude auth login`, renders the emitted verification URL, and writes the returned code to the same subprocess. Account status comes from `claude auth status` JSON, never from inspecting credential files.

**Claude uses the operator's browser and paste-back.** The container is headless — no `xdg-open`, no `DISPLAY` — so its own "Opening browser to sign in…" is a no-op that is dropped rather than rendered. The URL goes out over `/ws`, the operator opens it themselves, claude.com shows them a code, and that code comes back over `/ws` into the subprocess's stdin. There is no callback for a browser to reach: the printed URL redirects to `platform.claude.com`, not to us, so no port is published and no compose change is needed. The CLI does open a loopback listener during a login; it is unreachable from the host, its port is ephemeral, and one GET to it with a wrong `state` kills the login in flight — nothing in the container may probe local ports while one is running.

The pasted value is `<code>#<state>` and reaches stdin verbatim. The `#` is not a URL fragment: stripping it fails every login with a message that blames the operator's copy/paste.

Cancel and success both exit 0, so the exit code is never the verdict — `claude auth status` is re-run after the child ends and that answer is reported.

Plain pipes work with CLI 2.1.226; no PTY is required. Login is single-flight because each URL is tied to the subprocess and PKCE challenge that produced it; a second tab joins the flow in progress rather than spawning its own.

`claude setup-token` is for long-lived CI/script credentials, not interactive subscription login.

**Cursor** (`agent login`, `packages/adapters/cursor/src/login.ts`) is a poll-until-authorized flow, not a paste-back one: the URL goes out the same way and there is no code to send back. Its exit code is likewise never trusted — `agent status --format json` is re-asked when the child ends.

**Codex** uses a bounded, short-lived `codex app-server` over stdio for account and thread
operations, initialized using the pinned CLI protocol. `account/login/start` with
`chatgptDeviceCode` emits a verification URL and device code: the operator enters that code in
the browser; there is no paste-back field or callback. The shared login broker replays both
fields to reconnecting tabs. Cancellation uses `account/login/cancel`, sign-out uses
`account/logout`, and completion closes the client and freshly checks `account/read`.
Credentials remain in `agent-home`; URLs, codes, credentials and raw RPC auth errors are never
logged. Every child has request and process deadlines and is reaped on all paths.
Consoles launch Codex with `--sandbox danger-full-access`: the container is the sandbox
([PROJECT.md](PROJECT.md)), and Docker refuses the user namespaces and `/proc` mount that Codex's
bubblewrap sandbox needs, so a nested sandbox could only warn and fail. Codex's approval policy is
left to its own config and `/permissions`.

**opencode** has no single account: it fronts many model providers and answers on its own free
models with no credential at all. Connecting a provider (`/connect`) is done in its TUI, so the
adapter offers no login or sign-out (`login: false`), and status reads ready rather than signed
in: `opencode --version` answers and `opencode models` lists at least one model, reported as the
providers that have models (`ready · free models` when only the free ones do). With no model, it
is not ready and points the operator at a console rather than a sign-in. Credentials stay in the
CLI's own data directory on `agent-home`. The image, consoles and the loop bundle all set
`OPENCODE_DISABLE_AUTOUPDATE`, for the same root-owned-prefix reason as Claude and Codex.

**Compliance.** Subscription OAuth is restricted to Claude Code and claude.ai, while the Agent SDK requires API billing. Overseer therefore spawns the Claude Code binary. Re-check [Anthropic's legal and compliance docs](https://code.claude.com/docs/en/legal-and-compliance) before release.

### 2.1 Account usage

The provider widget shows subscription window utilization — Claude's short
session window and the weekly cap — plus the CLI's own reset phrases.

`getStatus()` reports auth only. When signed in it returns
`usageState: "pending"` so discovery and login never wait on `/usage`. A
background `refreshUsage()` asks `claude -p "/usage"`, re-checks auth when no windows
are returned, kills the usage process group on a
deadline (SIGTERM then SIGKILL), and pushes `provider.status` with `ready`
windows or `unavailable` after a miss/timeout. The widget reads
"retrieving usage… Ns" then either gauges or "usage currently not available".
Signed-in providers are rechecked every five minutes. Hide each gauge until a
parse supplies a percentage. Never present local token estimates as plan
consumption or billing data.

Codex background refresh and manual checks use `account/rateLimits/read` without model turns.
The widget shows both scheduled readings and a check button. Only supplied quota windows become
gauges, labelled using actual durations and reset timestamps. Missing data is unavailable; a
quota error preserves auth status. The same five-minute refresh cadence applies. API-key entry
and dollar-cost estimates are excluded.

opencode reads no usage: its per-session cost is the CLI's estimate from list prices, not a plan's
quota, so there is no refresh, no check button and no usage line.

### 2.2 Git access

**Server git generally goes through `packages/server/src/vcs/`.** Personality scaffolding directly
spawns its initial add/commit sequence. The module splits into `ops.ts` (on-demand operator operations, always fresh because
someone is waiting), `probe.ts` (the cached, gated read behind the project list), `ssh.ts` (the key
store below) and `env.ts` (commit identity). Before it existed the server spawned `git` from three
unrelated places with three different runners, and nothing made a change to *how* git is invoked
reach all of them.

Two deliberate exceptions. `workspace.ts` stays outside: it owns `WORKSPACE_ROOT`,
`isInsideWorkspace` and `scanWorkspace` — filesystem-containment concerns that happen to be asked
about repositories — and its `readGitState` is a thin delegate to the probe. And the dev loop's
`loop/bin/lib/git.sh` (§9) is a separate bash implementation carrying loop-specific concepts (the
train, per-branch metadata); it is not a duplicate awaiting consolidation.

Pushing and pulling need a credential the container does not otherwise have.
It gets one ed25519 keypair, **generated in place** by the operator from
settings › git access and written to `$HOME/.ssh` on the `agent-home` volume.
Only the public half is ever shown; no message in the protocol returns the
private key and no code path reads it. Generating rather than accepting a paste
keeps key material off the wire and out of the browser entirely.

`$HOME` rather than `/app/.overseer` because that is the one location every git
in the container finds unaided — the server's own operations, the agent's
`git push` inside a session, and anything typed into a console alike. The
alternative is threading `GIT_SSH_COMMAND` through every spawn point and still
missing the ones an agent invents. It sits under exactly the boundary this
section already describes for provider auth, and `./bin/reset` discards it with
that volume.

**No passphrase.** There is no ssh-agent here and nobody present when a
background agent pushes, so a passphrase would only move the secret somewhere
that also has to be stored. The key's protection is the volume boundary — the
same one holding every provider's subscription token, per §6.

**Host keys** are trusted on first use (`StrictHostKeyChecking accept-new`) and
pinned in `known_hosts` after. That is not `no`: a host whose key *changes* is
still refused, which is the attack that matters once enrolled. Pinning forge
keys into the image was rejected — they rotate, and it would cover only the
public forges rather than the self-hosted remotes this mostly exists for.

**Commit identity** (`user.name`/`user.email`) is set in the same place and
stored in internal memory (`state.json`, [data.md §2](data.md#2-internal-memory--appoverseer)),
then applied as `GIT_AUTHOR_*`/`GIT_COMMITTER_*` environment overrides on every git the server
spawns; `~/.gitconfig` gets a copy too, for processes it does not spawn. It cannot be a config file: the compose files pass those
variables through from the host and default them to empty strings, and git
reads them ahead of every config file, so a config identity would be silently
overridden and `git commit` would fail with "empty ident name".

---

## 3. Feature Map

Everything a CLI does for a conversation — streaming, tool calls, approvals, models, modes, agents,
skills, MCP, plans, checkpoints — is the CLI's own and is not listed here. This is the harness
around it. Ordered by priority.

### Core — the desk

| Feature                                   | Zone      | Mechanism                                                                 |
| ----------------------------------------- | --------- | ------------------------------------------------------------------------- |
| Provider CLI in a console window          | Consoles  | `consoleCommand` → server PTY → xterm.js (§1.2)                           |
| Many consoles, any project, freely placed | Consoles  | console registry; window stack; `/tile`                                   |
| Consoles survive the tab                  | Consoles  | attach/detach + scrollback ring; layout in localStorage                   |
| New session with an opening prompt        | Prompt    | `console.open {prompt}` → CLI positional argument                         |
| Resume a session                          | Sessions  | `claude --resume`, `agent --resume`, `codex resume`, `opencode --session`; attach if already running |
| Session list, every project and provider  | Sessions  | `session-index.ts` over adapter transcripts, rebuilt on transcript change |
| Waiting / working / idle lights           | Consoles  | Claude Code hooks, opencode plugin → `/hooks`; output heuristics otherwise |
| Callsigns and `@callsign` relay           | Prompt    | `callsigns.ts`, `relay.ts`; typed into an idle console via `relayInput`   |
| Agents address each other                 | Consoles  | `overseer who`/`tell` → `/relay`; framed, rate-limited, approval past cap  |
| Plain shell in a project                  | Consoles  | `kind: "shell"`                                                           |
| Dev loop in a console                     | Consoles  | `kind: "loop"`, take-over decision for a run held elsewhere              |
| Plan utilization + estimated spend        | Provider  | `/usage` via refreshUsage (§2.1)                                          |
| Subscription login                        | Provider  | `claude auth login` / `agent login`, plain spawn; URL out (§2)            |
| Projects, git, file view                  | Projects  | workspace monitor, `vcs/*`                                                |
| Theme switch                              | System    | `data-theme` on `:root`; choice persisted in internal memory             |
| Fullscreen field                          | System    | `.field.fullscreen` hides the rails, floats the clock; choice in localStorage |

### Next

| Feature                              | Zone     | Mechanism                                                               |
| ------------------------------------ | -------- | ----------------------------------------------------------------------- |
| Git worktree per console             | Consoles | `-w/--worktree` — how parallel agents stop fighting over one tree       |
| Desktop notifications                | global   | on a console going `waiting`                                            |
| Cross-console search                 | Sessions | index transcripts                                                        |
| Command palette                      | global   | keyboard-first jump to any console, session or action                   |

---

## 4. Session History Format

Moved to [data.md §3](data.md#3-provider-transcripts).

---

## 5. Container

```yaml
services:
  dind: # optional (§6.3): the daemon workspace projects build against — never the host's
    profiles: ["docker"]
    image: docker:28-dind
    privileged: true
    command: ["dockerd", "--host=unix:///run/dind/docker.sock"] # no tcp listener
    volumes:
      - dind-storage:/var/lib/docker
      - dind-socket:/run/dind
      - ${OVERSEER_WORKSPACE_HOST:-../overseer-workspace}:/workspace # same path the app sees, or bind mounts break
      - loop-db:/app/loop/db
  docker-filter: # optional (§6.3): the only thing that can reach that daemon
    profiles: ["docker"]
    build: { context: ., target: docker-filter }
    volumes:
      - dind-socket:/run/dind
      - ${OVERSEER_WORKSPACE_HOST:-../overseer-workspace}:/workspace:ro
      - loop-db:/app/loop/db:ro
  overseer:
    build: .
    ports: ["127.0.0.1:3000:3000"]
    volumes:
      - agent-home:/home/overseer # every provider's auth; never bound to host
      - overseer-memory:/app/.overseer
      - loop-db:/app/loop/db
      - ${OVERSEER_WORKSPACE_HOST:-../overseer-workspace}:/workspace # the only shared surface
    environment:
      - DOCKER_HOST=${OVERSEER_DOCKER_HOST:-…} # the filter when Docker is on (§6.3)
volumes:
  agent-home:
  overseer-memory:
  loop-db:
  dind-storage:
  dind-socket:
```

One service, or three with Docker for workspace projects turned on. The Node server serves the built SPA and handles `/api/*` + `/ws` on the same port; agent and auth CLIs run as child processes, and so does the dev loop (§9), so no reverse proxy is needed locally. The two optional services exist only so a workspace project's own `docker compose` test command has a daemon that is not the host's — see §6.3, and [data.md §1](data.md#1-where-things-live) for why paths are stated by the image rather than repeated here.

- `/workspace/<project>/` — one git project per directory. Session creation picks one; it becomes the process `cwd`.
- `/app/.overseer/` — internal memory ([data.md §2](data.md#2-internal-memory--appoverseer)).
- The image is a plain Debian base with Node copied in from the pinned official image, not a `node:` base: this container is an agent host, and Node is one runtime among several — the provider CLIs between them ship npm globals and a self-contained bundle with its own node. Alongside Node it needs `git`, `ripgrep` and a shell, which the CLIs shell out to; `jq`, `flock`, GNU `find`/`sed`/`awk` and `shellcheck`, which the dev loop's bash does (§9); `openssh-client`, which git over ssh does (§2); and the Docker client (§6.3). Auth login uses plain pipes (§2). Every console is a PTY through `node-pty` (native module), so image builds include a short-lived native toolchain for that dependency. Run as non-root, at the host user's uid ([data.md §1](data.md#1-where-things-live)).
- The remaining shared-write risk is host-side git activity while an agent edits the same project. Show each session's branch and dirty state so conflicts are visible.

---

## 6. Security

"Single-user, local" doesn't remove the problem:

- This is **remote code execution as a service**. Publish the host port on `127.0.0.1`. LAN access requires authentication.
- Check `Origin` on WebSocket upgrades. Mutating CLI hooks currently check loopback and their
  per-console token, but do not check `Origin` even when a browser supplies one.
- Answer only loopback `Host` names (`localhost`, `127.0.0.1`, `[::1]`, any port), on every HTTP
  route and on the upgrade. A DNS-rebinding page sends an `Origin` that matches its own `Host`, so
  the `Origin` check alone passes it; the name it cannot fake is the `Host`. Extra names come
  from `OVERSEER_ALLOWED_HOSTS` (comma-separated); the dev stack sets `web` for the e2e browser,
  whose `Host` Vite's proxy passes through.
- The container holds a live subscription token in `agent-home` — one per signed-in provider, since the app and the dev loop share it ([data.md §1](data.md#1-where-things-live)). Any RCE inside it exfiltrates all of them, which is also the argument for not mounting the host's own config.
- Permission modes, including the CLI's own bypass, are chosen in the CLI's TUI inside its console. Overseer offers no mode control of its own and must not add one that bypasses the CLI's own opt-in gesture.

### 6.1 Approvals and hooks

Approvals are answered in the CLI's own TUI, in its console. Overseer only learns that one is
pending, through the `Notification` hook (§1.2), and points the operator at the console. The hook
endpoint accepts loopback requests only, and each console's URL carries a random token, so a
process in the container cannot report for a console it was not started as.

The relay endpoint (`/relay/<console>/<token>`, [behaviour/relay.md §5](behaviour/relay.md#5-agent-to-agent))
uses the same token and the same loopback rule: an agent can relay only as itself. The token is
in the agent's environment, so any process in that console can relay as it — the same reach the
agent already has by typing. What bounds agent relays is the rate, the cooldown and the operator's
approval past them, not the token.

---

### 6.2 Where things live

Moved to [data.md §1](data.md#1-where-things-live).

### 6.3 The daemon that builds workspace projects

The dev loop's `verify` step ([behaviour/dev-loop.md](behaviour/dev-loop.md)) runs each project's own commands, and some of those are
`docker compose` — a project's own `bin/test` is. A project like that needs a Docker daemon inside
the sandbox, and a daemon is the largest grant the sandbox makes. So it is **off unless the operator
turns it on**, and filtered when it is on.

**Opt-in.** `OVERSEER_DOCKER=1` in `.env` starts two more services, both behind the `docker` compose
profile: `dind`, the daemon, and `docker-filter`, the proxy in front of it. `bin/_lib.sh` reads the
setting, turns the profile on and points the app container's `DOCKER_HOST` at the filter. Without
it neither service runs, and `DOCKER_HOST` is an address that does not exist and says why — the
Docker CLI prints it back, which is the whole error message a console needs. An instance that used
Docker before it became a choice, and has not chosen, is refused at start until it does.

**Not a bind of the host's `/var/run/docker.sock`.** That socket is
root-equivalent on the host; handing it to a container running an agent with an
unprefixed `Bash` would let a `docker run -v /:/host` undo the entire boundary
this section exists to draw. The sidecar's daemon has no view of the host's
images, containers or filesystem. It is `privileged`, which is a real grant: a
privileged container has wide access to the kernel of the machine Docker runs on.

**Nothing reaches the daemon but the filter.** `dind` listens on a unix socket only, in a volume
that only `docker-filter` mounts; it has no tcp listener, so a console cannot go around. The filter
(`packages/docker-filter`) is its own image in both stacks — never the repo bind mount, which an
agent can write to — and it:

- answers a short list of requests and refuses the rest: every read; create, start, stop, exec,
  attach, copy and remove for containers; pull, build, tag, push and remove for images; bridge
  networks; local volumes. Plugins, swarm and anything not listed are refused;
- reads the body of the requests that create something and refuses a container that asks for
  privileged mode, the sidecar's network, pid, IPC, UTS, user or cgroup namespace, a device, a
  capability beyond Docker's default set (and `SYS_NICE`), a security option other than
  `no-new-privileges`, unmasked `/proc` paths, another runtime or a cgroup parent; a privileged
  `exec`; a volume or mount with driver options; a network that is not a bridge;
- refuses a bind mount whose source is outside the directories the sidecar shares with the app. It
  mounts those directories itself, read-only, at the same paths, and follows symlinks before
  deciding, so a link inside the workspace that points at the sidecar's root is refused;
- re-issues every request rather than relaying bytes, sends on the body *it* parsed, and refuses a
  path or a field name the daemon would read differently from how it did (an escaped path, a
  field in another case). A connection becomes a raw stream only after the daemon has agreed to
  take it over.

A refusal is a `403` in the daemon's own error shape, so the CLI prints
`Error response from daemon: Overseer's Docker filter: <why>`.

**What the filter does not do.** It narrows what a console can ask for; it does not make the
sidecar a sealed boundary. The check on a bind source and the daemon's mount are two moments, and
a process that swaps a directory for a link between them can win that race. A kernel bug that lets
an ordinary container out lands in a privileged one. And a build can still ask for the sidecar's network.
With `OVERSEER_DOCKER` unset, none of this exists.

A project that needs something the filter refuses — a container that mounts the Docker socket to
start other containers is the usual one — cannot run that part inside Overseer.

`/workspace` and the loop's `db/` are mounted into `dind` at the **same absolute
paths** the app container sees. A project's compose file says
`volumes: [.:/app]`; compose resolves `.` client-side and hands the daemon an
absolute path, which the daemon then resolves in its own namespace. Without path
parity every project bind mount silently mounts an empty directory. `db/` is in
there because a `review` QA run happens in a worktree under it and runs the
project's test command from there. The filter's bind roots are those same two paths (in dev, all of
`/app/loop`, which is what that stack shares).

A project's published ports are the sidecar's: a console reaches them as `dind:<port>`.

### 6.4 Names that mean the host

A service on the operator's machine — a self-hosted GitLab is the case this
exists for — is often reached by a name the host's `/etc/hosts` points at
`127.0.0.1`. Inside the container that address is the container itself, so a
remote like `ssh://git@gitlab.local:2424/…` fails to connect even though the
port is published on the host.

The container can already reach the host's published ports through Docker's
host gateway; only the name is missing. The fix is to give the name that
address with `extra_hosts: ["<name>:host-gateway"]` on the app service, which
adds no reachability the container did not have and opens nothing inbound.

That line is the operator's, not the stack's, so it lives in an optional,
gitignored file that `bin/` merges over the stack when it exists:
`docker-compose.local.yml` for production (service `overseer`) and
`docker-compose.dev.local.yml` for dev (service `server`). A bare
`docker compose` call does not read them.

Two alternatives are refused:

- **Joining the other service's compose network.** A network is two-way, and
  the app listens unauthenticated on the container's own interface, so every
  container on that network — a CI runner included — could drive every agent.
- **`network_mode: host`.** It removes the network isolation outright.

Anything else put in a local file (other ports, other mounts) is the
operator's own configuration and outside what [SECURITY.md](../SECURITY.md)
defends.

## 7. Sizing

Targets, not yet enforced — the server does no idle reaping or budget enforcement today.

- Budget roughly 500 MB–1 GB per live process. Idle reaping prevents dormant sessions from pinning memory.
- The CLI has no built-in session timeout; enforce idle and turn limits server-side.
- Enforce session budgets server-side across process restarts.

---

## 8. Versioning

The product version lives in the root `package.json` `version` field. The footer and help window
read it via `packages/web/src/appVersion.ts`
([ui-ux.md §6](ui-ux.md#6-permanent-furniture)). Do not copy the number into docs or UI
source.

Versions follow [Semantic Versioning (SemVer)](https://semver.org/) — `MAJOR.MINOR.PATCH` (for
example `2.4.1`):

| Component | When it changes |
| --------- | --------------- |
| **MAJOR** | updates that break old compatibility |
| **MINOR** | new features added safely |
| **PATCH** | fixes, changes to existing behaviour, and other minor work |

Choose a release bump from the operator-visible changes since the last release, verified against
the diffs on `main`: a new feature calls for MINOR; fixes, changes to how existing features look or
behave, and other minor work call for PATCH. Refactors, tests, CI, dependency updates and documentation with no operator-visible
effect do not trigger a release. Breaking changes, including removed commands, changed defaults
and incompatible saved settings, require the operator's decision before choosing a version;
never bump MAJOR automatically. The milestone map in §8.2 records shipped capabilities and future
targets; it does not override these rules or authorize a `1.0.0` release.

### 8.1 Monorepo rule

The repo is private and unpublished. Every workspace package stays in **lockstep** with the root
`package.json` version:

| Package                         | Role                          |
| ------------------------------- | ----------------------------- |
| `overseer` (root)               | source of truth               |
| `@overseer/protocol`            | shared types                  |
| `@overseer/web`                 | SPA — footer reads root version via `appVersion.ts` |
| `@overseer/server`              | API / WS                      |
| `@overseer/adapter-claude` | adapter                       |
| `@overseer/adapter-codex`       | adapter                       |
| `@overseer/adapter-cursor`      | adapter                       |
| `@overseer/adapter-opencode`    | adapter                       |
| `@overseer/e2e`                 | Playwright suite              |
| `@overseer/docker-filter`       | proxy in front of the Docker sidecar (§6.3) |

On every release bump **all** of those `version` fields and sync `package-lock.json`. Use the
container wrapper: `./bin/npm version X.Y.Z --no-git-tag-version --workspaces --include-workspace-root`,
then `./bin/npm install --package-lock-only --ignore-scripts` if the lockfile needs synchronization.
Do not use host npm. If Docker is unavailable, edit only the root and workspace version fields and
their corresponding lockfile records directly, leaving dependency resolutions unchanged.
Release tags use `vX.Y.Z` on the release commit on `main`; preparing release files does not itself
authorize a commit, tag or push.

### 8.2 Milestone map

A record of what each pre-1.0 line shipped, not a reservation of future MINOR numbers. Earlier
releases keep their original numbers even where their bumps differ from §8;
[CHANGELOG.md](../CHANGELOG.md) has the detail.

| Version | Shipped |
| ------- | ------- |
| `0.0.x` | Scaffold: repo layout and container. |
| `0.1.x` | Overseer shell: wizard, internal memory, `overseer-personality`, workspace discovery, provider status. |
| `0.2.x` | Live sessions for `claude` and `cursor`, project creation, the dev loop driven from the app. |
| `0.3.x` | Working-tree diffs in the project window. |
| `0.4.x` | Skills import (removed in `0.5.0`). |
| `0.5.x` | CLI harness: conversations run in real console terminals that outlive their windows; the chat, capabilities and plans windows are removed in favour of the CLI. |

Future releases choose versions under §8 from the changes actually shipping. Product readiness and
any MAJOR bump require an explicit operator decision.

A migration that requires manual operator action — a moved directory or renamed setting — is a
breaking change even in this private, unpublished repo. Flag it and obtain the operator's version
decision before preparing a release. The release notes must state the upgrade action; a startup
check should refuse incompatible configuration and explain what to do. If that check or a
migration is missing, report the gap rather than assuming compatibility.

### 8.3 Release checklist

1. Audit the existing changelog and these instructions. Compare the newest release with the root,
   every workspace and the lockfile. If versions disagree, stop for the operator's decision unless
   the version field is explicitly documented as an unreleased next version. Preserve historical
   headings, dates, order and section structure; report suspect historical facts.
2. Identify the last release's `vX.Y.Z` tag, or, if there are no tags, the commit that introduced
   that release and its matching package versions. Read `git log <release-commit>..main` and the
   diffs, not just commit messages. Editing an old entry later does not move the release baseline.
   Uncommitted work is excluded unless the operator explicitly includes it.
3. Classify every operator-visible change (§8.4), including fixes missing from draft notes. Apply
   §8's bump rules and ask about breaking or ambiguous changes. If nothing visible has changed,
   leave the version alone and do not add an empty dated release.
4. Add one dated release at the top of [CHANGELOG.md](../CHANGELOG.md), converting any
   `## Unreleased` heading (§8.4), with an ISO `YYYY-MM-DD` date. Update the historical milestone map only when a shipped capability needs recording;
   README terminology should agree, without duplicating the product version.
5. Bump the root, all workspaces and their lockfile records together (§8.1). Validate the changelog
   against the actual parser, package versions and date format. The footer and help window read
   the root version automatically. The preparation diff must contain only release files and
   explicitly refined release documentation; preserve any pre-existing unrelated changes.
6. Report the entry, bump rationale, exclusions, historical issues and unresolved breaking changes.
   Suggest the scoped commit command and an annotated `vX.Y.Z` tag on the release commit on `main`.
   Do not execute a commit, tag or push without explicit authorization.

### 8.4 Changelog

`CHANGELOG.md` at the repo root is the operator-facing release notes, and the only place they
live. The `changelog` window renders it — `/changelog`, or a click on the version in the footer —
by importing the file and parsing it (`packages/web/src/changelog.ts`,
`packages/web/src/changelogSource.ts`), so the file *is* the feature; there is no second copy to
keep in sync.

Release headings are `## X.Y.Z — YYYY-MM-DD` — a bare version, no brackets, because the window
matches it against the running version to decide where to open. Draft notes for features, fixes
and behaviour changes belong with the change that makes them, under a bare `## Unreleased` heading
at the top of the file (create it if the top heading is a released version); never extend an
already-released entry. At release time audit those notes against the complete diff since the
release baseline (§8.3), then turn `## Unreleased` into the new dated entry. New entries use
`### Added`, `### Changed`, then `### Fixed`, omitting empty sections. Removed features are
observable changes: flag their compatibility impact before describing them under `Changed`.
Historical `Removed` sections and older section ordering stay as recorded.

Entries are conservative and public-facing: what an operator can now do or now sees, present
tense, one bullet line per change. No file paths, package names, PR numbers, internal type names,
or wire-message names — the reader runs this thing, they do not build it. A change that alters
nothing an operator can observe
gets **no** entry; refactors, tests, plumbing, docs and dependency bumps are deliberately absent,
and a release whose whole content is invisible gets no section. Private telemetry, infrastructure
and secrets rotation get no entry. Security fixes name only the class of issue, with no reproduction
recipe, reporters, internal hosts, customers or credentials; ask if disclosure is not yet safe.

A shipped section is a record, not a draft: never change an existing release version, heading,
date, ordering or section structure. Reword an old bullet only when strictly necessary for
clarity, terminology or consistency without changing its historical meaning. Preserve and report
apparently wrong historical facts for the operator's decision; do not silently add missing claims.

The app currently expects `## X.Y.Z — YYYY-MM-DD`; it also accepts a plain hyphen separator.
Keep a Changelog's bracketed `## [X.Y.Z] - YYYY-MM-DD` headings are read with the brackets in the
version, so they do not match the root version or receive the app's `current` label. A heading-format
change therefore needs an explicit decision and parser compatibility work before it can be adopted
without a display mismatch. Historical headings remain untouched.

### 8.5 After `1.0.0`

The same rules in §8 apply after `1.0.0`: new features call for MINOR, fixes, changes and other
minor work call for PATCH, and breaking protocol, settings or UX changes require the operator's
decision before a MAJOR bump. Internal cleanup alone does not trigger a release.

---

## 9. Dev Loop CLI (`loop/`)

A bash tool at `loop/` that runs development loops — request through review — against a workspace
project, driven by one interactive provider session (the loop's own overseer). It is not a
`packages/*` workspace and is versioned independently of §8.1. It runs in this container, never on
the host (`loop/run` refuses without `OVERSEER_IN_CONTAINER`), and shares with the app the one
`/workspace`, the provider registry (§1.1.2), the `agent-home` auth volume and, when it is on, the Docker sidecar (§6.3).
The app reaches it as a `loop` console (§1.2). Its provider choice (`loop/.provider`) is
independent of the app's `attached_provider`.

Full behaviour: [behaviour/dev-loop.md](behaviour/dev-loop.md). Usage: [`loop/README.md`](../loop/README.md).
