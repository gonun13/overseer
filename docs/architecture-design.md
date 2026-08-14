# Design Doc: Overseer

**What it is:** a single-page, fullscreen web console for driving CLI coding agents. Claude Code is the first adapter; the architecture assumes there will be others.

**Shape:** one Docker container holds the agent CLI, its state, and the web server. The only bind mount is `./workspace`, which contains git projects and an import/export staging directory. Auth and application state live in container-owned volumes.

**Aesthetic:** a surveillance console, not a chat app — dense, monospace, border-only chrome, one focus zone at a time. See [ui-ux-design.md](ui-ux-design.md).

---

## 1. Architecture

```
packages/
  protocol/           shared TS types — the frontend/backend contract
  web/                React + Vite + Tailwind SPA
  server/             Node: WS + REST, session supervisor, adapter registry
  adapters/
    claude-code/      spawns `claude`, normalizes stream-json → protocol
```

**Frontend-first, adapter-agnostic.** `protocol/` is written to serve the UI, not to mirror any one CLI's output. Adapters translate into it.

### 1.1 The adapter interface

```typescript
interface AgentAdapter {
  id: string; // "claude-code"
  capabilities: AdapterCapabilities;
  createSession(opts: SessionOpts): Promise<SessionHandle>;
  resumeSession(id: string): Promise<SessionHandle>;
  listSessions(): Promise<SessionMeta[]>;
  getStatus(): Promise<AdapterStatus>;
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

`AdapterCapabilities` contains `streamingDeltas`, `permissionPrompts`, `interrupt`, `subagents`, `mcp`, `skills`, `effortLevels`, `costReporting`, `checkpoints`, and `backgroundAgents`. The UI renders only supported controls.

Normalized event union: `session.init`, `text.delta`, `thinking.delta`, `tool.start` / `tool.delta` / `tool.end`, `permission.request`, `todo.update`, `subagent.start` / `subagent.text` / `subagent.end`, `turn.end` (usage + cumulative process cost), `usage.limit`, `error`, `exit`.

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

The container owns `~/.claude` in a named volume. Host config is never mounted.

**Login from the frontend.** The system zone runs `claude auth login`, renders the emitted verification URL, and writes the returned code to the same subprocess. Account status comes from `claude auth status` JSON, never from inspecting credential files.

**The browser is the operator's, on the operator's machine, and paste-back is the only channel.** The container is headless — no `xdg-open`, no `DISPLAY` — so its own "Opening browser to sign in…" is a no-op that is dropped rather than rendered. The URL goes out over `/ws`, the operator opens it themselves, claude.com shows them a code, and that code comes back over `/ws` into the subprocess's stdin. There is no callback for a browser to reach: the printed URL redirects to `platform.claude.com`, not to us, so no port is published and no compose change is needed. The CLI does open a loopback listener during a login; it is unreachable from the host, its port is ephemeral, and one GET to it with a wrong `state` kills the login in flight — nothing in the container may probe local ports while one is running.

The pasted value is `<code>#<state>` and reaches stdin verbatim. The `#` is not a URL fragment: stripping it fails every login with a message that blames the operator's copy/paste.

Cancel and success both exit 0, so the exit code is never the verdict — `claude auth status` is re-run after the child ends and that answer is reported.

Plain pipes work with CLI 2.1.226; no PTY is required. Login is single-flight because each URL is tied to the subprocess and PKCE challenge that produced it; a second tab joins the flow in progress rather than spawning its own.

`claude setup-token` is for long-lived CI/script credentials, not interactive subscription login.

**Config import/export.** `/workspace/_overseer/` is the staging channel. IMPORT and EXPORT copy an allowlist of settings, skills, agents, and MCP configuration one direction at a time. Credentials and session history are never staged.

**Compliance.** Subscription OAuth is restricted to Claude Code and claude.ai, while the Agent SDK requires API billing. Overseer therefore spawns the Claude Code binary. Re-check [Anthropic's legal and compliance docs](https://code.claude.com/docs/en/legal-and-compliance) before release.

### 2.1 Account usage

The top bar shows plan utilization, estimated activity cost, and active session count.

The adapter normalizes `rate_limit_event` to `usage.limit`, the only source for subscription utilization and reset time. Hide that gauge until an event supplies both. Separately, persist token usage and estimated cost from `result` messages. In streaming mode, `total_cost_usd` is cumulative for the process: store non-negative deltas and treat a lower value after resume as a counter reset. Never present local estimates as plan consumption or billing data.

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
| Plan utilization + estimated spend                 | Top bar  | `usage.limit` + normalized result counters (§2.1)                 |
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
| Additional CLI adapters           | —            | the reason for §1.1                                                 |

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
  overseer:
    build: .
    ports: ["127.0.0.1:3000:3000"]
    volumes:
      - claude-home:/home/node/.claude # container-owned; never bound to host
      - overseer-memory:/app/.overseer
      - ./workspace:/workspace # the only shared surface
    environment:
      - CLAUDE_CONFIG_DIR=/home/node/.claude
      - OVERSEER_INTERNAL_DIR=/app/.overseer
volumes:
  claude-home:
  overseer-memory:
```

One service: the Node server serves the built SPA and handles `/api/*` + `/ws` on the same port. Agent and auth CLIs run as child processes; no reverse proxy is needed locally.

- `/workspace/<project>/` — one git project per directory. Session creation picks one; it becomes the process `cwd`.
- `/workspace/_overseer/` — import/export staging only.
- `/app/.overseer/` — internal memory plus SQLite usage history, session index, and search index.
- Image needs `git`, `ripgrep`, and a shell alongside Node; the CLI shells out to all three. The auth flow needs no PTY (§2), so the runtime stage needs no native-build toolchain. Run as non-root.
- The remaining shared-write risk is host-side git activity while an agent edits the same project. Show each session's branch and dirty state so conflicts are visible.

---

## 6. Security

"Single-user, local" doesn't remove the problem:

- This is **remote code execution as a service**. Publish the host port on `127.0.0.1`. LAN access requires authentication.
- Check `Origin` on WebSocket upgrades and mutating HTTP requests; otherwise another page can drive the local server.
- The container holds a live subscription token in `claude-home`. Any RCE inside it exfiltrates that token — which is also the argument for not mounting the host's `~/.claude`.
- `bypassPermissions` removes the last guard. Gate it behind an explicit server-side opt-in mirroring the CLI's own `--allow-dangerously-skip-permissions` gesture, and render it in `--danger` whenever active.

### 6.1 Approval protocol

In streaming-input mode, permission prompts arrive as `control_request` messages and are resolved with matching `control_response` messages. Re-initialization can redeliver pending requests, so the server deduplicates them by request ID. A `PreToolUse` hook is for policy that must inspect every tool call, not for ordinary user approval.

---

## 7. Sizing

- Budget roughly 500 MB–1 GB per live process. Idle reaping prevents dormant sessions from pinning memory.
- The CLI has no built-in session timeout; enforce idle and turn limits server-side.
- Enforce session budgets server-side across process restarts.

---

## 8. Versioning

**Current release:** `0.1.1`

Versions follow [SemVer](https://semver.org/) (`MAJOR.MINOR.PATCH`). The number reflects **which
design-doc milestone is shipped**, not commit count or PR volume. When in doubt, compare the running
product against the doc sections below — not git history alone.

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

On every release bump **all** of those `version` fields, sync the matching entries in
`package-lock.json`, and tag `vX.Y.Z` on the merge commit to `main`. Do not hard-code a version in UI
source — `packages/web/src/appVersion.ts` imports the root `package.json` version for the footer and
help window ([ui-ux-design.md §6](ui-ux-design.md#6-permanent-furniture)).

### 8.2 Milestone map

Each **MINOR** pre-1.0 marks a doc-defined tier becoming operator-visible. **PATCH** is fixes,
refactors, or docs within the current tier. Do not bump MINOR for work that only closes gaps inside
the tier already claimed by the current version.

| Version   | Design-doc tier | Ship bar |
| --------- | --------------- | -------- |
| `0.0.x`   | —               | Scaffold only: repo layout, container, no behavioral spec live. |
| `0.1.x`   | [overseer-behavior.md](overseer-behavior.md) | **Overseer shell** — wizard phases (§4), progressive furniture (§4), internal memory (§6.2), `overseer-personality` (§6.3), workspace discovery, adapter `getStatus()` surfacing. Wireframe windows may still use fixtures; the overseer path uses real server state. |
| `0.2+`    | TBD             | Reserve the next MINOR for the next coherent pre-MVP tier once it is written into a design doc and listed under README [Status](../README.md#status). Do not invent a number in advance. |
| `1.0.0`   | §3 **MVP**      | **Core loop** — every row in the MVP table (§3) works end-to-end for `claude-code`: spawn/resume sessions, stream transcript + tools, inline approval, model/mode controls, subscription login from the UI, usage surfacing, crash/auth failure handling. |
| `1.x`     | §3 **Important**| Additive features from the Important tier. Each MINOR should map to a closed subset of that table (call it out in release notes). |
| `2.x+`    | §3 **Nice to have** + later adapters | Major product expansion; breaking protocol or UX contract bumps MAJOR. |

**Explicit non-goals for `0.1.x`:** §3 MVP (sessions, live console, approvals queue), §5 adapter-backed
querying in [overseer-behavior.md](overseer-behavior.md) ("planned, not built"), and credential-file
auth checks instead of `claude auth status` — see README [Status](../README.md#status).

### 8.3 Release checklist

1. Walk the milestone table: does the product meet the ship bar for the target version?
2. Update README [Status](../README.md#status) if the "in place" / "still missing" lists changed.
3. Bump the same version in root and every `@overseer/*` `package.json`; sync `package-lock.json`.
   The footer and help window pick up the root version automatically — no separate UI edit.
4. Set **Current release** at the top of this section and in README [Versioning](../README.md#versioning).
5. Tag `vX.Y.Z` on the merge commit to `main` (annotated tag preferred).
6. Mention the version in the PR or release notes when the bump is intentional — not as a drive-by in
   unrelated work.

### 8.4 After `1.0.0`

Normal SemVer applies on top of the tier map: breaking protocol or UX changes → `MAJOR`; new Important-tier
capability → `MINOR`; fix or internal cleanup → `PATCH`.
