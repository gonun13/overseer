# Design Doc: Overseer

**What it is:** a single-page, fullscreen web console for driving CLI coding agents. Claude Code is the first fully wired provider; the catalog also lists stub providers whose CLIs ship in the image but whose adapters are not implemented yet. The architecture assumes more full adapters will follow.

**Shape:** one Docker container holds the agent CLIs, their state, and the web server. The only bind mount is `./workspace`, which contains git projects and an import/export staging directory. Auth and application state live in container-owned volumes.

**Aesthetic:** a surveillance console, not a chat app — dense, monospace, border-only chrome, one focus zone at a time. See [ui-ux-design.md](ui-ux-design.md).

---

## 1. Architecture

```
packages/
  protocol/           shared TS types — the frontend/backend contract
  web/                React + Vite + Tailwind SPA
  server/             Node: WS + REST, session supervisor, adapter registry
                      (also registers catalog stubs: codex, opencode, github-copilot)
  adapters/
    claude-code/      spawns `claude`, normalizes stream-json → protocol
```

**Frontend-first, provider-agnostic.** `protocol/` is written to serve the UI, not to mirror any one CLI's output. Adapters translate provider-specific behavior into it. Catalog stubs live in the server registry (`stub-adapters.ts`) until they earn a real `packages/adapters/<id>/` package.

**Provider vs adapter.** Two words for the two sides of the same id string (`"claude-code"`, `"codex"`, …):

| Term         | Layer            | Where it appears                                                                                                              |
| ------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **provider** | operator/product | what the operator attaches, signs in and configures — the provider widget and window, `provider.connect`, `GET /api/providers` |
| **adapter**  | internal runtime | the code that translates a CLI into `protocol/` — `AgentAdapter` (§1.1), `packages/adapters/`, the server's adapter registry   |

One provider is attached at a time, and it is backed by exactly one adapter.

### 1.1 The adapter interface

```typescript
interface AgentAdapter {
  id: string; // "claude-code"
  capabilities: AdapterCapabilities;
  createSession(opts: SessionOpts): Promise<SessionHandle>;
  resumeSession(id: string): Promise<SessionHandle>;
  listSessions(): Promise<SessionMeta[]>;
  getStatus(): Promise<AdapterStatus>;
  // What this provider offers a session, in one project. Optional: an adapter
  // that cannot enumerate omits it and the server refuses the request rather
  // than filling menus with values the CLI would reject.
  listOptions?(opts: { projectDir: string }): Promise<ProviderOptions>;
}

interface SessionHandle {
  events: AsyncIterable<AgentEvent>;
  send(msg: UserMessage): void; // queues if a turn is in flight
  interrupt(): Promise<void>;
  setModel(model: string): Promise<void>;
  setEffort(effort: string): Promise<void>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  resolvePermission(id: string, d: PermissionDecision): Promise<void>;
  close(): Promise<void>;
}
```

The three runtime setters are still unbuilt: a session runs on what it spawned
with, and a control-row pick arms the *next* session rather than retargeting the
one in flight.

### 1.1.1 Discovering what a provider offers

`ProviderOptions` is
`{ models, permissionModes, agents, defaultPermissionMode?, defaultModel? }`, each
entry `{ value, label, detail?, danger? }` — `value` is what reaches the CLI, `label`
and `detail` are the provider's own words. Every list may be empty; an adapter that
could not get an answer reports nothing rather than a guess, and the UI leaves that
row's menu shut.

The two `default*` fields exist so a control row can read what the next turn will
actually run on instead of a blank. They are not guesses about behaviour: the mode is
the CLI's own `current_permission_mode`, and the model is the option the CLI itself
labels "Default (recommended)", whose whole meaning is "whatever is configured".

For `claude-code` the answer has two halves, because the CLI only knows one of them.

**Models and the current permission mode** come from one `initialize` control request
— 0 tokens, no session written, ~1.2s:

```jsonc
// stdin, to `claude -p --input-format stream-json --output-format stream-json --verbose`
{"type":"control_request","request_id":"overseer_initialize","request":{"subtype":"initialize"}}
```

The reply carries `models[]` (with `displayName`, `description`, `supportsEffort`,
`supportedEffortLevels`), `current_permission_mode`, `commands`, and
`available_output_styles`.

**Subagents** come off disk instead, from the two directories the operator writes to:

```
<project>/.claude/agents/*.md    this project
$CLAUDE_CONFIG_DIR/agents/*.md   every project
```

`name` and `description` are read from each file's YAML frontmatter, falling back to
the filename; project wins on a name collision, which is the CLI's own precedence.
The list always leads with `none`.

The reply's own `agents[]` is deliberately **not** used. It mixes the operator's
subagents in with the CLI's built-in routing agents (`Explore`, `Plan`,
`general-purpose`, `statusline-setup`, …) with nothing to tell them apart, and those
built-ins are Claude's internal machinery, not a choice the operator made — offering
them would put the CLI's plumbing in a menu beside the permission modes.

**Permission modes** are in neither source: the only machine-readable enumeration is
the CLI's own rejection message. They are a constant in the adapter, pinned to the
same build as the `usage.ts` and `login.ts` parses.

Nothing here is cached. Half the answer is files the operator can add or edit at any
moment, so a cached list would go on offering agents they deleted; the ask is
free and happens on human timescales (attaching a provider, changing project, opening
a control row). The server single-flights it so two tabs cannot spawn two children.

`AdapterCapabilities` contains `streamingDeltas`, `permissionPrompts`, `interrupt`, `subagents`, `mcp`, `skills`, `effortLevels`, `costReporting`, `checkpoints`, and `backgroundAgents`. The UI renders only supported controls.

Normalized event union: `session.init`, `text.delta`, `thinking.delta`, `tool.start` / `tool.delta` / `tool.end`, `permission.request`, `todo.update`, `subagent.start` / `subagent.text` / `subagent.end`, `turn.end` (usage + cumulative process cost), `usage.limit`, `error`, `exit`.

### 1.1.2 The provider registry

`providers/<id>/` is the one declaration of what a provider is, read by both
sides of this repo. A directory carries `manifest.json`, and — when the loop can
open a session on it — `provider.sh` plus that provider's own config tree.

```json
{
  "id": "claude-code",
  "cli": "claude",
  "configDir": ".claude",
  "install": { "kind": "npm", "spec": "@anthropic-ai/claude-code@2.1.226" },
  "app": "adapter",
  "loop": "bundle"
}
```

A provider can be implemented on one side, the other, or both, which is what the
two role fields say. `app` is `adapter` when this server has real wiring,
`stub` when the CLI is in the image but sessions/auth/console are not built yet,
`none` when the app should not list it at all. `loop` is `bundle` when the
directory carries `provider.sh`, `none` otherwise. `cursor` today is
`stub`/`bundle`: the loop runs on it, the app only lists it.

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

### 1.2 Process model — one long-lived process per session

The `claude-code` adapter keeps one process open per active session in bidirectional streaming mode:

```typescript
const sessionId = randomUUID(); // mint it — don't discover it afterwards
spawn(
  "claude",
  [
    "-p",
    "--input-format",
    "stream-json", // user turns written to stdin as JSON
    "--output-format",
    "stream-json",
    "--include-partial-messages", // token-level deltas
    "--include-hook-events", // lifecycle events in-stream
    "--forward-subagent-text", // subagent text, tagged parent_tool_use_id
    "--replay-user-messages", // echo of our input = ack + ordering
    "--verbose",
    "--session-id",
    sessionId,
    "--model",
    model,
    "--effort",
    effort,
    "--permission-mode",
    mode,
  ],
  { cwd: projectDir },
); // a directory under /workspace
```

- **stdin:** user content blocks plus control messages. Images can travel over the existing WebSocket as content blocks; no upload endpoint is required.
- **stdout:** NDJSON: `system`, `assistant`, `user`, `stream_event`, `control_request`, `control_response`, `result`, and `rate_limit_event`.
- **Runtime control:** use control requests for interrupt, model, permission mode, and other supported settings. Do not kill the process to interrupt a turn.
- **Idle reaping:** close after 15 minutes; re-spawn with `--resume <sessionId>` on the next message. The UI marks the session dormant while no process is running.

`--forward-subagent-text` and `--include-hook-events` provide live subagent activity without custom hook scripts.

### 1.3 Async side-tasks (skills and subagent editing)

Skills and subagents are edited by asking the agent, not through dedicated forms.

Each edit opens a **side-task**: a short-lived session scoped to the relevant config directory. Its status appears in the capabilities zone, and the capability row refreshes from disk when it finishes.

A raw file editor remains optional.

---

## 2. Auth & Config

The container owns the agent's home in a named volume, `agent-home` — every provider CLI's config and auth, not Claude's alone (§6.2). Host config is never mounted.

**Login from the frontend.** The system zone runs `claude auth login`, renders the emitted verification URL, and writes the returned code to the same subprocess. Account status comes from `claude auth status` JSON, never from inspecting credential files.

**The browser is the operator's, on the operator's machine, and paste-back is the only channel.** The container is headless — no `xdg-open`, no `DISPLAY` — so its own "Opening browser to sign in…" is a no-op that is dropped rather than rendered. The URL goes out over `/ws`, the operator opens it themselves, claude.com shows them a code, and that code comes back over `/ws` into the subprocess's stdin. There is no callback for a browser to reach: the printed URL redirects to `platform.claude.com`, not to us, so no port is published and no compose change is needed. The CLI does open a loopback listener during a login; it is unreachable from the host, its port is ephemeral, and one GET to it with a wrong `state` kills the login in flight — nothing in the container may probe local ports while one is running.

The pasted value is `<code>#<state>` and reaches stdin verbatim. The `#` is not a URL fragment: stripping it fails every login with a message that blames the operator's copy/paste.

Cancel and success both exit 0, so the exit code is never the verdict — `claude auth status` is re-run after the child ends and that answer is reported.

Plain pipes work with CLI 2.1.226; no PTY is required. Login is single-flight because each URL is tied to the subprocess and PKCE challenge that produced it; a second tab joins the flow in progress rather than spawning its own.

`claude setup-token` is for long-lived CI/script credentials, not interactive subscription login.

**Config import/export.** `/workspace/_overseer/` is the staging channel. IMPORT and EXPORT copy an allowlist of settings, skills, agents, and MCP configuration one direction at a time. Credentials and session history are never staged.

**Compliance.** Subscription OAuth is restricted to Claude Code and claude.ai, while the Agent SDK requires API billing. Overseer therefore spawns the Claude Code binary. Re-check [Anthropic's legal and compliance docs](https://code.claude.com/docs/en/legal-and-compliance) before release.

### 2.1 Account usage

The provider widget shows subscription window utilization — Claude's short
session window and the weekly cap — plus the CLI's own reset phrases.

`getStatus()` reports auth only. When signed in it returns
`usageState: "pending"` so discovery and login never wait on `/usage`. A
background `refreshUsage()` asks `claude -p "/usage"` only (no second auth
check — that can hang on the same outage), kills the process group on a
deadline (SIGTERM then SIGKILL), and pushes `provider.status` with `ready`
windows or `unavailable` after a miss/timeout. The widget reads
"retrieving usage… Ns" then either gauges or "usage currently not available".
Signed-in providers are rechecked every five minutes. Hide each gauge until a
parse supplies a percentage. Never present local token estimates as plan
consumption or billing data.

Once sessions exist, `rate_limit_event` (normalized to `usage.limit`) can
refresh the same windows live. Persist token usage and estimated cost from
`result` messages separately. In streaming mode, `total_cost_usd` is
cumulative for the process: store non-negative deltas and treat a lower
value after resume as a counter reset.

---

## 3. Feature Map

Ordered by priority; within each tier, roughly by how often it gets used.

### MVP — the core loop

| Feature                                            | Zone     | Mechanism                                                         |
| -------------------------------------------------- | -------- | ----------------------------------------------------------------- |
| Send prompt, stream response                       | Console  | stream-json stdin; `stream_event` deltas out                      |
| Transcript: text, tool calls, collapsible thinking | Console  | normalized `text.delta` / `tool.*` / `thinking.delta`             |
| Diff rendering for `Edit` / `Write`                | Console  | parse tool input; unified diff in inspector                       |
| Terminal output for `Bash`                         | Console  | ANSI-aware renderer                                               |
| Live todo checklist                                | Console  | `TodoWrite` tool calls → `todo.update`                            |
| Tool approval, inline                              | Console  | `can_use_tool` control request (see §6.1)                         |
| Permission mode selector                           | Top bar  | startup flag + runtime `set_permission_mode` control request      |
| Interrupt turn                                     | Console  | `interrupt` control request                                      |
| Queue message during a turn                        | Console  | buffer in `SessionHandle.send`                                    |
| Model + effort selector                            | Console  | startup flags + runtime control updates                           |
| Create session in a project                        | Sessions | pick a dir under `/workspace`; mint `--session-id`                 |
| Resume session + history replay                    | Sessions | `--resume`; parse JSONL for backfill (§4)                         |
| Session list with live status                      | Sessions | supervisor state + JSONL mtime                                    |
| Plan utilization + estimated spend                 | Provider | `/usage` via refreshUsage; later `usage.limit` (§2.1) |
| Subscription login                                 | System   | `claude auth login`, plain spawn, no PTY; URL out to the operator's own browser, pasted code in (§2) |
| Theme switch                                       | System   | `data-theme` on `:root`; choice persisted in internal memory      |
| Crash / exit / auth-failure surfacing              | Console  | classify stream errors, result subtype, signal, and exit code     |

### Important

| Feature                                   | Zone         | Mechanism                                                                                                     |
| ----------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------- |
| Cross-session approval queue              | Approvals    | aggregate `permission.request` from every live session                                                        |
| Permission rules editor                   | Approvals    | "allow always" writes `Bash(git *)`-style patterns to `settings.json`; `--allowedTools` / `--disallowedTools` |
| Plan-mode approval screen                 | Approvals    | `ExitPlanMode` output — an approval surface, not a chat bubble                                                |
| Nested subagent turns                     | Console      | `--forward-subagent-text`, grouped by `parent_tool_use_id`                                                    |
| Background agents                         | Sessions     | supervisor-managed sessions; `--bg` is incompatible with `-p`                                         |
| Context window gauge                      | Console      | `get_context_usage` control request                                                                        |
| Budget ceiling per session                | Console      | persist spend; pass remaining budget via `--max-budget-usd` on each spawn                                |
| MCP server list + health + tool inventory | Capabilities | `claude mcp list` / `get`; `⏸ Pending approval` for unapproved `.mcp.json`                                    |
| MCP add / remove                          | Capabilities | `mcp add` (stdio/http/sse, `-e`, `--header`), `add-json`, `remove`                                            |
| MCP OAuth login                           | Capabilities | `mcp login --no-browser`; URL out, redirect URL in                                                            |
| Per-session MCP sets                      | Capabilities | `--mcp-config`, `--strict-mcp-config`                                                                         |
| Skills + subagents inventory              | Capabilities | filesystem discovery of `.claude/skills`, `.claude/agents`                                                    |
| Agent-driven skill/subagent editing       | Capabilities | async side-tasks (§1.3)                                                                                       |
| Pin a subagent / ephemeral agents         | Console      | `--agent <name>`, `--agents <json>`                                                                           |
| File attachments, image paste             | Console      | content blocks on stdin                                                                                       |
| Session fork                              | Sessions     | `--fork-session`                                                                                              |
| Session naming                            | Sessions     | `-n <name>`                                                                                                   |
| Multi-root workspace                      | Sessions     | `--add-dir`                                                                                                   |
| Search across sessions                    | Sessions     | index JSONL into SQLite                                                                                       |
| Config import / export                    | System       | via `/workspace/_overseer/` (§2)                                                                              |
| Hook event stream                         | System       | `--include-hook-events`                                                                                       |
| CLI version + health                      | System       | `claude doctor`, version drift warning                                                                        |
| Settings source inspector                 | System       | read known files and apply documented user → project → local precedence                                       |

### Nice to have

| Feature                           | Zone         | Mechanism                                                           |
| --------------------------------- | ------------ | ------------------------------------------------------------------- |
| Checkpoints / rewind              | Console      | `rewind_files` control request                                     |
| Git worktree per session          | Sessions     | `-w/--worktree` — how parallel sessions stop fighting over one tree |
| Session entity graph              | Console      | SVG node map of subagents, MCP servers, files touched               |
| Branch tree for forked history    | Sessions     | full `parentUuid` tree instead of newest-leaf (§4)                  |
| Plugin management                 | Capabilities | `claude plugin`, `--plugin-dir`, `--plugin-url`                     |
| Custom system prompt per session  | Console      | `--system-prompt`, `--append-system-prompt`                         |
| Structured job mode               | Sessions     | `--json-schema` — run-and-return rather than chat                   |
| Fallback model chain              | System       | `--fallback-model a,b`                                              |
| Prompt suggestions                | Console      | `--prompt-suggestions`; predicted next prompt after each turn       |
| Resume from a PR                  | Sessions     | find linked session metadata; `--from-pr` itself is interactive     |
| Troubleshooting modes             | System       | `--safe-mode`, `--bare`                                             |
| Raw file editor for skills/agents | Capabilities | watcher + conflict handling                                        |
| Transcript export                 | Console      | markdown / JSON                                                     |
| Command palette                   | global       | keyboard-first jump to any session, zone, or action                 |
| Desktop notifications             | global       | on approval request or turn completion                              |
| Additional providers              | —            | catalog stubs (`codex`, `opencode`, `github-copilot`) land early; full adapter runtime still later |
| Dev-loop CLI                      | —            | incubating outside `packages/*` as `loop/`; bash + a provider CLI + files only, in the app's container (§9) |

---

## 4. Session History Format

`$CLAUDE_CONFIG_DIR/projects/<cwd-slug>/<session-uuid>.jsonl`, one JSON object per line. Observed shapes:

- **Message records:** `type`, `uuid`, `parentUuid`, `sessionId`, `timestamp`, `message`, `cwd`, `gitBranch`, `version`, `userType`, `promptId`, `isMeta`, `isSidechain`.
- **Operation records:** `type`, `operation`, `sessionId`, `timestamp` (compaction and similar).

Two rules matter:

1. **`parentUuid` makes this a tree, not a log.** V1 walks from the newest leaf to the root and renders that path; a full branch tree is a nice-to-have.
2. **`isSidechain` marks subagent turns.** Nest them under their parent; never inline them into the main transcript.

JSONL is undocumented and may drift. Use it only for history backfill, pin the CLI version, and disable replay for unsupported versions. Live state always comes from the stream.

---

## 5. Container

```yaml
services:
  dind: # the daemon workspace projects build against (§6.3) — never the host's
    image: docker:28-dind
    privileged: true
    volumes:
      - dind-storage:/var/lib/docker
      - ./workspace:/workspace # same path the app sees, or bind mounts break
      - loop-db:/app/loop/db
  overseer:
    build: .
    ports: ["127.0.0.1:3000:3000"]
    volumes:
      - agent-home:/home/overseer # every provider's auth; never bound to host
      - overseer-memory:/app/.overseer
      - loop-db:/app/loop/db
      - ./workspace:/workspace # the only shared surface
    environment:
      - DOCKER_HOST=tcp://dind:2375
volumes:
  agent-home:
  overseer-memory:
  loop-db:
  dind-storage:
```

Two services. The Node server serves the built SPA and handles `/api/*` + `/ws` on the same port; agent and auth CLIs run as child processes, and so does the dev loop (§9), so no reverse proxy is needed locally. The sidecar exists only so a workspace project's own `docker compose` test command has a daemon that is not the host's — see §6.3, and §6.2 for why paths are stated by the image rather than repeated here.

- `/workspace/<project>/` — one git project per directory. Session creation picks one; it becomes the process `cwd`.
- `/workspace/_overseer/` — import/export staging only.
- `/app/.overseer/` — internal memory plus SQLite usage history, session index, and search index.
- The image is a plain Debian base with Node copied in from the pinned official image, not a `node:` base: this container is an agent host, and Node is one runtime among several — the provider CLIs between them ship npm globals and a self-contained bundle with its own node. Alongside Node it needs `git`, `ripgrep` and a shell, which the CLIs shell out to; `jq`, `flock`, GNU `find`/`sed`/`awk` and `shellcheck`, which the dev loop's bash does (§9); `gh`, which the loop's `publish` does; and the Docker client (§6.3). Auth login uses plain pipes (§2). The raw OPEN CONSOLE escape hatch uses `node-pty` (native module), so image builds include a short-lived native toolchain for that dependency. Run as non-root, at the host user's uid (§6.2).
- The remaining shared-write risk is host-side git activity while an agent edits the same project. Show each session's branch and dirty state so conflicts are visible.

---

## 6. Security

"Single-user, local" doesn't remove the problem:

- This is **remote code execution as a service**. Publish the host port on `127.0.0.1`. LAN access requires authentication.
- Check `Origin` on WebSocket upgrades and mutating HTTP requests; otherwise another page can drive the local server.
- The container holds a live subscription token in `agent-home` — one per signed-in provider, since the app and the dev loop share it (§6.2). Any RCE inside it exfiltrates all of them, which is also the argument for not mounting the host's own config.
- `bypassPermissions` removes the last guard. Gate it behind an explicit server-side opt-in mirroring the CLI's own `--allow-dangerously-skip-permissions` gesture, and render it in `--danger` whenever active. It is the one `permissionModes` entry carrying `danger`, so the control row already accents it; the server-side opt-in is still to build.

The modes themselves are the CLI's own six — `acceptEdits`, `auto`, `bypassPermissions`,
`manual`, `dontAsk`, `plan`. There is no `default` mode: the CLI accepts the word
undocumented and reports `manual` back as `default`, which the adapter folds so the
UI never offers two words for one mode.

### 6.1 Approval protocol

In streaming-input mode, permission prompts arrive as `control_request` messages and are resolved with matching `control_response` messages. Re-initialization can redeliver pending requests, so the server deduplicates them by request ID. A `PreToolUse` hook is for policy that must inspect every tool call, not for ordinary user approval.

---

### 6.2 Where things live

One container runs the app and the loop, and the split between what an image
rebuild replaces and what survives it is load-bearing:

| Path | What | Persistence |
|---|---|---|
| `/app` | code — `packages/`, `loop/`, `providers/` | image; a bind mount of the repo in dev |
| `/home/overseer` | every provider CLI's config and auth | the `agent-home` volume |
| `/workspace` | the one surface shared with the host | host bind mount |
| `/app/.overseer` | internal memory (docs/overseer.md §6.2) | the `overseer-memory` volume |
| `/app/loop/db` | the dev loop's file store | the repo in dev, the `loop-db` volume in prod |

**Nothing that an image rebuild must be able to replace may live under
`/home/overseer`.** A named volume mounts there and shadows the image's copy
from the first mount onward, so anything baked in is frozen at that moment. It
is why Cursor's bundle is installed to `/opt` and symlinked onto `PATH` rather
than left where its installer puts it, under `$HOME`.

One volume for every provider rather than one per provider is deliberate:
adding a provider should not mean editing two compose files, and a CLI that
invents its own config path still persists. The cost is that `agent-home` holds
every provider's token at once — the exposure §6 already names for Claude's,
now plural.

The container runs as the host user's uid/gid (`OVERSEER_UID`/`OVERSEER_GID`,
filled by `bin/_lib.sh` from `id`). Without that, bind mounts owned by any user
other than 1000 are unwritable and git refuses the workspace as dubiously owned.

### 6.3 The daemon that builds workspace projects

`loop/steps/verify.md` runs each project's own commands, and some of those are
`docker compose` — `workspace/design-patterns/bin/test` is. So the stack ships a
`dind` sidecar, and the app container gets the Docker client plus
`DOCKER_HOST=tcp://dind:2375`.

**Not a bind of the host's `/var/run/docker.sock`.** That socket is
root-equivalent on the host; handing it to a container running an agent with an
unprefixed `Bash` would let a `docker run -v /:/host` undo the entire boundary
this section exists to draw. The sidecar's daemon has no view of the host's
images, containers or filesystem. It is `privileged`, which is a real grant, but
a scoped one.

`/workspace` and the loop's `db/` are mounted into `dind` at the **same absolute
paths** the app container sees. A project's compose file says
`volumes: [.:/app]`; compose resolves `.` client-side and hands the daemon an
absolute path, which the daemon then resolves in its own namespace. Without path
parity every project bind mount silently mounts an empty directory. `db/` is in
there because a `review` QA run happens in a worktree under it and runs the
project's test command from there.

2375 is never published; it is reachable on the compose network alone, which is
the only reason plain tcp is acceptable.

## 7. Sizing

- Budget roughly 500 MB–1 GB per live process. Idle reaping prevents dormant sessions from pinning memory.
- The CLI has no built-in session timeout; enforce idle and turn limits server-side.
- Enforce session budgets server-side across process restarts.

---

## 8. Versioning

The product version lives in the root `package.json` `version` field. The footer and help window
read it via `packages/web/src/appVersion.ts`
([ui-ux-design.md §6](ui-ux-design.md#6-permanent-furniture)). Do not copy the number into docs or UI
source.

Versions follow [Semantic Versioning (SemVer)](https://semver.org/) — `MAJOR.MINOR.PATCH` (for
example `2.4.1`):

| Component | When it changes |
| --------- | --------------- |
| **MAJOR** | updates that break old compatibility |
| **MINOR** | new features added safely |
| **PATCH** | small bugs or errors are fixed |

The number reflects **which design-doc milestone is shipped**, not commit count or PR volume. When
in doubt, compare the running product against the doc sections below — not git history alone. How
those three components map onto Overseer's tiers is in §8.2 (pre-1.0) and §8.4 (after `1.0.0`).

### 8.1 Monorepo rule

The repo is private and unpublished. Every workspace package stays in **lockstep** with the root
`package.json` version:

| Package                         | Role                          |
| ------------------------------- | ----------------------------- |
| `overseer` (root)               | source of truth               |
| `@overseer/protocol`            | shared types                  |
| `@overseer/web`                 | SPA — footer reads root version via `appVersion.ts` |
| `@overseer/server`              | API / WS                      |
| `@overseer/adapter-claude-code` | adapter                       |
| `@overseer/e2e`                 | Playwright suite              |

On every release bump **all** of those `version` fields and sync `package-lock.json` (`./bin/npm
install`). Tag `vX.Y.Z` on the merge commit to `main`.

### 8.2 Milestone map

Each **MINOR** pre-1.0 marks a doc-defined tier becoming operator-visible. **PATCH** is fixes,
refactors, or docs within the current tier. Do not bump MINOR for work that only closes gaps inside
the tier already claimed by the current version.

| Version   | Design-doc tier | Ship bar |
| --------- | --------------- | -------- |
| `0.0.x`   | —               | Scaffold only: repo layout, container, no behavioral spec live. |
| `0.1.x`   | [overseer-behavior.md](overseer-behavior.md) | **Overseer shell** — wizard phases (§4), progressive furniture (§4), internal memory (§6.2), `overseer-personality` (§6.3), workspace discovery, provider status surfacing via `getStatus()`. The overseer path uses real server state; other windows stay empty until live APIs land. |
| `0.2+`    | TBD             | Reserve the next MINOR for the next coherent pre-MVP tier once it is written into a design doc and listed under README [Status](../README.md#status). Do not invent a number in advance. |
| `1.0.0`   | §3 **MVP**      | **Core loop** — every row in the MVP table (§3) works end-to-end for `claude-code`: spawn/resume sessions, stream transcript + tools, inline approval, model/mode controls, subscription login from the UI, usage surfacing, crash/auth failure handling. |
| `1.x`     | §3 **Important**| Additive features from the Important tier. Each MINOR should map to a closed subset of that table (call it out in release notes). |
| `2.x+`    | §3 **Nice to have** + later providers | Major product expansion; breaking protocol or UX contract bumps MAJOR. |

**Explicit non-goals for `0.1.x`:** §3 MVP stream-json sessions / transcript / approvals queue,
§5 provider-backed querying in [overseer-behavior.md](overseer-behavior.md) ("planned, not built"),
and credential-file auth checks instead of `claude auth status` — see README
[Status](../README.md#status). The raw OPEN CONSOLE PTY escape hatch (ui-ux-design.md §5.3) is
separate from the MVP "Console" zone in §3 and may ship inside `0.1.x`.

### 8.3 Release checklist

1. Walk the milestone table: does the product meet the ship bar for the target version?
2. Update README [Status](../README.md#status) if the "in place" / "still missing" lists changed.
3. Bump the same version in root and every `@overseer/*` `package.json`; sync `package-lock.json`
   (`./bin/npm install`). The footer and help window pick up the root version automatically.
4. Tag `vX.Y.Z` on the merge commit to `main` (annotated tag preferred).
5. Mention the version in the PR or release notes when the bump is intentional — not as a drive-by in
   unrelated work.

### 8.4 After `1.0.0`

Normal SemVer applies on top of the tier map: breaking protocol or UX changes → `MAJOR`; new Important-tier
capability → `MINOR`; fix or internal cleanup → `PATCH`.

---

## 9. Dev Loop CLI (`loop/`)

A command-line tool, at `loop/` in this repo, that runs development loops —
feature requests, fixes, changes — against a project under `workspace/<name>/`.
It is **not** a `packages/*` workspace: it uses only bash scripts, a provider
CLI, and plain files, and is versioned/released independently of the §8.1
package table. It's incubating — see §3's Feature Map row — with the intent to
fold into the main app, at which point it would gain a real `packages/` entry
and join the lockstep-versioned set. Usage lives in
[`loop/README.md`](../loop/README.md); this section is the spec-level summary.

**It runs in the app's container, not on the host.** The `implement` step edits
a project in place and runs that project's own test command, on a session
granted `Write`, `Edit` and an unprefixed `Bash` — the widest grant anywhere in
this repo, and a subagent inherits all of it. That belongs behind the same
boundary as everything else here (§6), so `./bin/loop <workspace>` opens the
session inside the running stack and `loop/run` refuses to start one on the
host, keyed on `OVERSEER_IN_CONTAINER` exactly as `bin/_in-container.sh` guards
the app's own npm scripts. The `loop/bin/*` commands are deliberately not
guarded: they read and record state and open no session.

Sharing the container is not only about the sandbox. The app and the loop are
two front-ends onto the same three things — a workspace, a provider CLI, and a
project's toolchain — and they used to disagree about all three. Now they do
not: one `/workspace` (both read `OVERSEER_WORKSPACE`), one provider registry
(§1.1.2), one `agent-home` volume holding every CLI's auth, and one Docker
daemon for project builds (§6.2).

**The overseer.** `loop/run <workspace>` opens one interactive session on the
configured provider agent and hands it the terminal. That session is the
orchestrator: it reads the workspace's state, resumes what is mid-flight, plans
what is scoped, or asks the human for a new request, and keeps going until the
human stops it. Its instructions are [`loop/overseer.md`](../loop/overseer.md).
Bash owns no control flow — the tool deliberately does not reimplement, as a
shell state machine, the orchestration the agent is better at.

**The bash surface.** What bash does own is everything a language model should
not improvise: allocating request ids and paths, stamping timestamps,
validating what a step wrote, appending to the log, and serializing access to
the project's working tree. That is fourteen commands — `list`, `new`, `step`, `record`, `tracers`,
`phase`, `land`, `publish`, `train`, `worktree`, `signoff`, `close`, `clear`,
`provider` (plus `check`) — each taking a workspace name, printing JSON to
stdout and human text to stderr. The
overseer drives them and acts on their output. `loop/bin/step` hands a step one
**named** JSON context (inputs, output path, and the literal frontmatter block
to copy); `loop/bin/record` checks the written artifact against the same values
before `index.jsonl` is touched. There is no headless mode: a step that needs
no human runs as a subagent of the overseer, not as a second bash code path.

**File taxonomy.** Every file the tool writes is exactly one of three kinds:

| Kind | Format | What goes here |
|---|---|---|
| Human intentions/decisions | `.txt` | Verbatim human input — a raw request, and a review sign-off |
| Automated operation log | `.jsonl` | Append-only record of what the automation did, one line per event |
| Everything else | `.md` | Agent-authored substantive content, meant to flow forward as context for the next step — or double as skill/subagent/command material |

Markdown is chosen over JSON for the substantive record specifically because
it's directly usable as LLM context with no parse step; a small frontmatter
block (same tolerant, line-based convention §1.1.1 describes for
`.claude/agents/*.md` name/description) carries the handful of fields that need
to stay structured. One exception: `memory.md` is also `.md` but has no
frontmatter and isn't per-request — it's a living document per workspace, read
and rewritten on every `research` run, flowing forward to every future
step/request for that workspace rather than just the next one.

**Provider abstraction.** `loop/bin/lib/providers.sh` loads a bundle from the
shared registry at `providers/<id>/` (§1.1.2) — `manifest.json` plus
`provider.sh` plus that provider's config tree. The contract is two functions,
`provider_check_available` and `provider_session <prompt> <workspace_dir>`,
because a provider's whole job is to open one session. **Invariant:** the only
config a session sees is its own bundle's — never `loop/` root, never another
provider. Each bundle enforces that with whatever its CLI gives it, and the two
differ: `claude-code` takes `--settings <file>` with `--setting-sources ""`, so
no discovery runs at all, while `cursor` has no config-path flag and pins the
process's working directory to the bundle instead. Stating the mechanism per
bundle rather than as one sentence matters, because the weaker form is only as
good as the CLI's preference for the nearest config — and the repo root is
itself a git root carrying `.claude/`. **The session's workspace is always the
project**, never the bundle: the operator asked for a project, and `implement`
edits one. Both `claude-code` (CLI `claude`) and
`cursor` (CLI `agent`) are real implementations; which one runs is the loop's
own choice, in `loop/.provider`, and stays separate from the app's
`attached_provider` (§2). `loop/bin/check-providers` lints that a provider's
CLI name and config directory stay inside its own bundle, deriving what to look
for from the manifests themselves.

**Step instructions are provider-neutral.** Each step's behavior is one file,
`loop/steps/<step>.md`, read by whichever agent runs that step — so it counts
as orchestration for the isolation lint above. They were previously duplicated
as slash commands inside each provider's config tree.

**Context-window discipline.** Prompts keep bulk content out of the prompt body
(passed by file path, read on demand) and sandwich critical instructions at both
ends rather than stating them once — a standing convention for every step. The
overseer applies it to itself: it delegates every step it can so the artifacts
never enter its own window, and steers by `loop/bin/list --json` rather than by
reading `db/`.

**Terminology.** The loop is made of nine **steps**, in order: `request` →
`research` → `scope` → `plan` → `implement` → `verify` → `decide` → `commit` →
`review`. `plan` → `implement` → `verify` → `decide` (4-7) is a closed automated
loop with no human in it. `decide` is the only thing that says where a request
goes next, writing it as a `route` on its record: `implement` (the next tracer
group), `rework` (the same group, with a directive), `plan`, `scope` (3, the one
route that puts the human back in) or `commit` (8). Every other handoff is a
straight, one-directional pass. Inside a `plan`, work
is decomposed into **horizontal/vertical layers**, **phases**, and **vertical
tracers** (see [`loop/README.md`](../loop/README.md)); the plan file also
carries an `impact` score.

**Who runs a step.** One question decides it: whether the step needs the human —
plus one addition, because routing is the overseer's own job. `scope` is a
conversation, so the overseer runs it in its own session; it runs `decide`
itself too, since deciding what happens next is the one thing an orchestrator
must not delegate, and `steps/decide.md` bounds what it may read to keep that
cheap. `request`, `research`, `plan`, `implement`, `verify` and `commit` need nobody,
so each is delegated to a subagent that reads its instruction file and reports
one line back. `review` splits: the overseer runs it, because it ends in the
human's decision, but delegates the audit of the whole request's diff to a
subagent — so it is the second `steps/*.md` the overseer reads, alongside
`scope.md`.

**The exclusive phase.** `implement`, `verify`, `decide` and `commit` take the
project's working tree, so exactly one request may be in that phase per
workspace — two of them editing the same tree is an unrecoverable conflict.
Bash enforces it rather than the overseer: `loop/bin/step` claims
`db/<slug>/implement.lock` (two lines: the holding request's id, and what that
claim has recorded) before handing over a context and refuses when another
request holds it, and `loop/bin/record` refuses a step whose claim has lapsed.
Unlike the session lease it outlives the session on purpose, so a restarted
overseer finds the tree still owned. A request holds it for its whole stay in
the cycle, not for one lap: `decide` turns the cycle without handing the tree
back, because the changes are still there and still that request's.

`loop/bin/land` ends the phase — not `record commit`. Recording a commit means
the artifact was written and validated; the repository has not moved, and
letting another request in there would cut its branch off a tree still holding
uncommitted work. `review` is outside the phase entirely: it reads a throwaway
`git worktree` at the request's own branch, so a request under review never
blocks the next one from starting, which is the whole point of releasing at
`land`. The lock also enforces order within a lap: `loop/bin/step` turns away a
request that has already recorded that step under its current claim — `record`
marks each one it commits on the lock's second line — and tells it which step
comes next instead, because a run nothing has checked must not be built on.
`decide` then clears that line, which is what lets the same request take
another lap. The marker is scoped to the claim, so a failed `record` is still
retryable. The exception is a `decide` that routed to `commit`: its marks stay,
since re-running it would only re-judge work already judged.
`loop/bin/phase --release` and `loop/bin/clear` are administrative cleanup
outside a session; neither marks anything verified.

**Nothing is public until a human approves it.** A request's work moves in
three separately-refusable stages: `land` commits it to a local branch,
`publish` pushes that branch and opens the pull request, `close` merges it.
Only the last two are visible to anyone else, and `publish` is refused until a
recorded `review` says the human approved the work — a `rejected` review
publishes nothing at all.

That ordering is why `review` reads a local branch rather than a pull request.
A review that runs after the pull request is open is a formality: the mistake
is already public, and withdrawing it is its own announcement. Auditing a local
branch makes the human's approval the act that publishes. The cost is that the
`commit` step writes a pull-request title and body that may never be used —
cheap, and it is `review` that most wants them, since a body describing what
changed and what to look at is exactly a reviewer's briefing.

**The train, and where branch metadata lives.** Past `commit` several requests
are alive at once, each on its own branch with a pull request open. They do not
collide because every request's branch is cut off the one in front of it — a
train of stacked branches ending at the default branch. `loop/bin/step` cuts it
at *phase entry* rather than at commit, so a request's diff is exactly its own
work against exactly the tree it was written on, and a dirty tree is refused
there because whatever is in it belongs to somebody else.

That chain is stored in the workspace repo's own `.git/config` —
`branch.<b>.looprequest`, `.loopbase`, `.looppr` — which is **the one place the
tool writes outside `db/`**, and a deliberate exception to the rule stated
above. The rule exists so the tool's bookkeeping is never mistaken for project
source or committed into someone's app repo; `.git/config` is neither tracked
nor committable, and per-branch metadata is where git itself keeps
`branch.<b>.remote`. A table in `db/` would instead be a cache of git state
that goes stale whenever a branch is touched outside the loop. `loop/bin/train`
is the only reader, so the overseer never runs git to find out where things
stand. `loop/bin/close` prunes those keys once the work has landed, which is
the whole of how a merged request stops being anyone's base.

**Current scope.** All nine steps are implemented — `request`, `research`,
`scope`, `plan`, `implement`, `verify`, `decide`, `commit`, `review`: `request`
captures raw text via `loop/bin/new` and structures it
into `loop/db/<slug>/requests/<id>.md`; `research` explores the actual project,
writes `loop/db/<slug>/research/<id>.md` as context for `scope`, and rewrites
the shared `loop/db/<slug>/memory.md`; `scope` grills the human, first establishing that the work will change files
at all — a request that changes none is an audit rather than a code change, and
`scope` offers to take it out of the loop rather than spend a whole cycle
dead-ending at `land`, which is only the backstop for it — and writes
`loop/db/<slug>/scope/<id>.md`; `plan` writes `loop/db/<slug>/plan/<id>.md`;
`implement` builds one tracer group — test-first where the project allows it —
and rewrites `loop/db/<slug>/implement/<id>.md`, a cumulative record whose
tracer ledger is how the next run and a restarted overseer know what is done.
A group is the pending `parallel: true` tracers of the lowest unfinished phase,
or a single tracer when it is not parallel; `loop/bin/tracers --next` computes
it, so which tracers may run together is a bash rule rather than the overseer's
judgement, and the overseer learns what is left without reading the plan. The
group is batched into one run because the implement record is one file per
request — fanning it out across runs would have them clobber each other's
ledger.
`verify` then runs the project's own tests and lints and drives the change the
way a user would, writing `loop/db/<slug>/verify/<id>.md` — a linear record
that never judges and never stops at the first red result, since a failure is
what the next step most needs to see. `decide` reads that plus the implement
record and appends one decision block to `loop/db/<slug>/decide/<id>.md`,
carrying a `route` that bash validates against a fixed set and `loop/bin/list`
surfaces, so the next action survives the overseer being restarted mid-cycle.
That record is appended to rather than rewritten: the sequence of decisions is
how `decide` sees it has already sent the same group back twice, which is the
rule that escalates a stuck group to a re-plan instead of a third rework. `commit` writes the commit message and the pull-request body from the records
and the real diff into `loop/db/<slug>/commit/<id>.md`, and runs no git at all;
`loop/bin/land` then stages, commits it to the request's branch and releases
the phase, skipping the commit if it already happened so an interrupted run is
retried by rerunning it. It appends a `landed` event of its own, which is what
distinguishes "the record was written" from "the work is committed" after a
crash between the two. `land` is **local**: nothing is pushed. `review` audits
the whole request's diff for security and performance in a delegated subagent,
walks the operator through manual QA in a throwaway `git worktree` at that
request's branch, and records the outcome they chose — captured first,
verbatim, by `loop/bin/signoff` into the second of the two `.txt` kinds.
`loop/bin/publish` pushes the branch and opens the pull request, and is refused
unless that review recorded `approved` or `followups`. `loop/bin/close` then
ends the request once the pull request has landed. A per-slug `running.json` lease surfaces an active overseer
session to other terminals. Adding a step is a row in `bin/lib/db.sh`'s
`LOOP_STEPS` table plus a `loop/steps/<step>.md`, and a name in
`LOOP_EXCLUSIVE_STEPS` if it takes the working tree.

**The tool grant is sized for `implement`, not the overseer.** It is the only
step that edits the project, `verify` is the other that runs it, and a subagent
inherits the session's tools — so in-place edits and an unprefixed shell are granted to the
session, where they were previously denied outright. What bounds it is a deny
list per bundle for the irreversible verbs (`rm`, `sudo`, `git commit`,
`git push`), `overseer.md`'s standing rule that only an `implement` subagent may
change a file under the workspace, and a human watching the whole session.
