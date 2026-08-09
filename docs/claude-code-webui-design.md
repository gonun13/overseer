# Design Doc: Overseer

**What it is:** a single-page, fullscreen web console for driving CLI coding agents. Claude Code is the first adapter; the architecture assumes there will be others.

**Shape:** one Docker container holds the agent CLI, its config, and the web server. The host shares exactly one directory with it — `./workspace`, containing git projects. Everything else, including agent auth, lives inside the container.

**Aesthetic:** a surveillance console, not a chat app — dense, monospace, border-only chrome, one focus zone at a time. See [design-system.md](design-system.md).

---

## 1. Architecture

```
packages/
  protocol/           shared TS types — the frontend/backend contract
  web/                React + Vite + Tailwind SPA
  server/             Node: WS + REST, session supervisor, adapter registry
  adapters/
    claude-code/      spawns `claude`, normalizes stream-json → protocol
    mock/             replays recorded fixtures; needs no CLI, no auth
```

**Frontend-first, adapter-agnostic.** `protocol/` is written to serve the UI, not to mirror any one CLI's output. Adapters translate into it. The `mock` adapter replays recorded session fixtures over the same interface, so the entire frontend can be built and tested with no CLI, no container, and no subscription burn — that is the point of splitting it out on day one.

### 1.1 The adapter interface

```typescript
interface AgentAdapter {
  id: string;                            // "claude-code"
  capabilities: AdapterCapabilities;
  createSession(opts: SessionOpts): Promise<SessionHandle>;
  resumeSession(id: string): Promise<SessionHandle>;
  listSessions(): Promise<SessionMeta[]>;
}

interface SessionHandle {
  events: AsyncIterable<AgentEvent>;
  send(msg: UserMessage): void;          // queues if a turn is in flight
  interrupt(): void;
  resolvePermission(id: string, d: PermissionDecision): void;
  close(): Promise<void>;
}
```

`AdapterCapabilities` is a flag set — `streamingDeltas`, `permissionPrompts`, `interrupt`, `subagents`, `mcp`, `skills`, `effortLevels`, `costReporting`, `checkpoints`, `backgroundAgents`. **The UI renders controls from these flags**, so an adapter that can't do mid-turn approval simply doesn't grow an approvals zone rather than showing a dead one.

Normalized event union: `session.init`, `text.delta`, `thinking.delta`, `tool.start` / `tool.delta` / `tool.end`, `permission.request`, `todo.update`, `subagent.start` / `subagent.text` / `subagent.end`, `turn.end` (usage + cost), `error`, `exit`.

### 1.2 Process model — one long-lived process per session

> **Main correction to the previous draft.** It spawned `claude -p <input> --resume <id>` once per turn. That forecloses most of the product: no permission prompts mid-turn, no interrupt, no streaming input, no queued follow-ups, plus a cold start and history re-tokenization every turn.

The `claude-code` adapter holds one process open per active session in bidirectional streaming mode:

```typescript
const sessionId = randomUUID();            // mint it — don't discover it afterwards
spawn("claude", [
  "-p",
  "--input-format",  "stream-json",        // user turns written to stdin as JSON
  "--output-format", "stream-json",
  "--include-partial-messages",            // token-level deltas
  "--include-hook-events",                 // lifecycle events in-stream
  "--forward-subagent-text",               // subagent text, tagged parent_tool_use_id
  "--replay-user-messages",                // echo of our input = ack + ordering
  "--verbose",
  "--session-id",      sessionId,
  "--model",           model,
  "--effort",          effort,
  "--permission-mode", mode,
], { cwd: projectDir });                   // a directory under /work
```

- **stdin:** `{"type":"user","message":{"role":"user","content":[...]}}`. Content blocks mean pasted images and file attachments need no separate upload path.
- **stdout:** NDJSON. Route `system` (subtype `init` — model, cwd, tools, MCP servers, slash commands), `assistant`, `user`, `stream_event`, `control_request`/`control_response`, `result` (`usage`, `total_cost_usd`, `duration_ms`, `num_turns`).
- **Interrupt** via a `control_request`, not SIGKILL — killing loses the turn and the process's in-memory context.
- **Idle reaping:** close after 15 min idle; next message re-spawns with `--resume <sessionId>`. Same UUID, no user-visible seam. The session's dot goes from live to dormant in the UI and back.

`--forward-subagent-text` and `--include-hook-events` give live subagent activity in-stream, which removes the previous draft's proposed `SubagentStart`/`SubagentStop` hook scripts entirely.

### 1.3 Async side-tasks (skills and subagent editing)

Skills and subagents are **not** edited through forms. They are edited by asking the agent, which is what it's good at — and those edits shouldn't block the console the user is working in.

Every capability item carries an action that opens a **side-task**: a separate short-lived session, scoped to the relevant config directory, running in the background with a generated prompt ("edit the `code-review` skill to also check for N+1 queries"). It reports into the capabilities zone rather than the main transcript, with its own status dot. The user keeps working; results land when they land, and the capability row refreshes from disk.

This means the "smart" editing path and the plain chat path are the same machinery, and a raw file editor stays optional (nice-to-have) rather than load-bearing.

---

## 2. Auth & Config

The container owns its own `~/.claude` in a named Docker volume. The host's config is never mounted and never touched.

**Login from the frontend.** The system zone runs `claude setup-token` under a PTY (`node-pty` — the flow expects a TTY), scrapes the verification URL from its output, and renders it as a link plus a paste-back field for the returned code, which is written to the subprocess stdin. The container is headless and can't open a browser, so URL-out / code-in is the flow. Session state, expiry, and account are shown alongside it.

**Bootstrapping from existing config.** `/work` is the only shared surface, so it's also the sanctioned config channel: drop files at `./workspace/_overseer/import/` on the host, hit IMPORT in the system zone, and the server copies them into `$CLAUDE_CONFIG_DIR`. EXPORT does the reverse for backup. Explicit, auditable, one direction at a time — not a live bind mount that lets host and container race each other.

**Compliance.** Anthropic's Feb 2026 policy restricts Pro/Max OAuth tokens to Claude Code and claude.ai; the Agent SDK requires API-key billing even for personal tools. Headless CLI mode is still Claude Code and stays on subscription auth — hence spawning the binary rather than importing `@anthropic-ai/claude-agent-sdk`. Re-check https://code.claude.com/docs/en/legal-and-compliance; this is actively evolving.

### 2.1 Account usage

The top bar carries a persistent usage readout — plan consumption against the rolling limit window, spend, and active session count.

Source of truth, in preference order: (1) rate-limit / usage metadata if the stream surfaces it for subscription accounts — **verify this empirically**, it's the only unknown here; (2) otherwise the server aggregates `usage` and `total_cost_usd` from every `turn.end` across all sessions in a local SQLite store, tracking the rolling window itself. Build the gauge against the local aggregate, since it's needed regardless for per-project and historical spend, and treat any first-party figure as an override when confirmed.

---

## 3. Feature Map

Ordered by priority; within each tier, roughly by how often it gets used.

### MVP — the core loop

| Feature | Zone | Mechanism |
|---|---|---|
| Send prompt, stream response | Console | stream-json stdin; `stream_event` deltas out |
| Transcript: text, tool calls, collapsible thinking | Console | normalized `text.delta` / `tool.*` / `thinking.delta` |
| Diff rendering for `Edit` / `Write` | Console | parse tool input; unified diff in inspector |
| Terminal output for `Bash` | Console | ANSI-aware renderer |
| Live todo checklist | Console | `TodoWrite` tool calls → `todo.update` |
| Tool approval, inline | Console | `can_use_tool` control request (see §6.1) |
| Permission mode selector | Top bar | `--permission-mode` at spawn; visible always, colour-coded |
| Interrupt turn | Console | `control_request` subtype `interrupt` |
| Queue message during a turn | Console | buffer in `SessionHandle.send` |
| Model + effort selector | Console | `--model`, `--effort` |
| Create session in a project | Sessions | pick a dir under `/work`; mint `--session-id` |
| Resume session + history replay | Sessions | `--resume`; parse JSONL for backfill (§4) |
| Session list with live status | Sessions | supervisor state + JSONL mtime |
| Account usage + spend | Top bar | §2.1 |
| Subscription login | System | `claude setup-token` under PTY |
| Theme switch | System | `data-theme` on `:root` |
| Crash / exit / auth-failure surfacing | Console | distinguish exit causes; they look identical at the process level |

### Important

| Feature | Zone | Mechanism |
|---|---|---|
| Cross-session approval queue | Approvals | aggregate `permission.request` from every live session |
| Permission rules editor | Approvals | "allow always" writes `Bash(git *)`-style patterns to `settings.json`; `--allowedTools` / `--disallowedTools` |
| Plan-mode approval screen | Approvals | `ExitPlanMode` output — an approval surface, not a chat bubble |
| Nested subagent turns | Console | `--forward-subagent-text`, grouped by `parent_tool_use_id` |
| Background agents | Sessions | `--bg`; `claude agents` to manage |
| Context window gauge | Console | token accounting from `turn.end` |
| Budget ceiling per session | Console | `--max-budget-usd` |
| MCP server list + health + tool inventory | Capabilities | `claude mcp list` / `get`; `⏸ Pending approval` for unapproved `.mcp.json` |
| MCP add / remove | Capabilities | `mcp add` (stdio/http/sse, `-e`, `--header`), `add-json`, `remove` |
| MCP OAuth login | Capabilities | `mcp login` — same URL-out/code-in flow as §2 |
| Per-session MCP sets | Capabilities | `--mcp-config`, `--strict-mcp-config` |
| Skills + subagents inventory | Capabilities | filesystem discovery of `.claude/skills`, `.claude/agents` |
| Agent-driven skill/subagent editing | Capabilities | async side-tasks (§1.3) |
| Pin a subagent / ephemeral agents | Console | `--agent <name>`, `--agents <json>` |
| File attachments, image paste | Console | content blocks on stdin |
| Session fork | Sessions | `--fork-session` |
| Session naming | Sessions | `-n <name>` |
| Multi-root workspace | Sessions | `--add-dir` |
| Search across sessions | Sessions | index JSONL into SQLite |
| Config import / export | System | via `/work/_overseer/` (§2) |
| Hook event stream | System | `--include-hook-events` |
| CLI version + health | System | `claude doctor`, version drift warning |
| Settings source inspector | System | `--setting-sources user,project,local` — shows *which* file a value came from |

### Nice to have

| Feature | Zone | Mechanism |
|---|---|---|
| Checkpoints / rewind | Console | `~/.claude/file-history/`; restore working tree to a checkpoint |
| Git worktree per session | Sessions | `-w/--worktree` — how parallel sessions stop fighting over one tree |
| Session entity graph | Console | SVG node map of subagents, MCP servers, files touched |
| Branch tree for forked history | Sessions | full `parentUuid` tree instead of newest-leaf (§4) |
| Plugin management | Capabilities | `claude plugin`, `--plugin-dir`, `--plugin-url` |
| Custom system prompt per session | Console | `--system-prompt`, `--append-system-prompt` |
| Structured job mode | Sessions | `--json-schema` — run-and-return rather than chat |
| Fallback model chain | System | `--fallback-model a,b` |
| Prompt suggestions | Console | `--prompt-suggestions`; predicted next prompt after each turn |
| Resume from a PR | Sessions | `--from-pr` |
| Troubleshooting modes | System | `--safe-mode`, `--bare` |
| Raw file editor for skills/agents | Capabilities | needs a watcher + conflict handling; §1.3 makes it optional |
| Transcript export | Console | markdown / JSON |
| Command palette | global | keyboard-first jump to any session, zone, or action |
| Desktop notifications | global | on approval request or turn completion |
| Additional CLI adapters | — | the reason for §1.1 |

---

## 4. Session History Format

`$CLAUDE_CONFIG_DIR/projects/<cwd-slug>/<session-uuid>.jsonl`, one JSON object per line. Observed shapes:

- **Message records:** `type`, `uuid`, `parentUuid`, `sessionId`, `timestamp`, `message`, `cwd`, `gitBranch`, `version`, `userType`, `promptId`, `isMeta`, `isSidechain`.
- **Operation records:** `type`, `operation`, `sessionId`, `timestamp` (compaction and similar).

Two things the original doc glossed:

1. **`parentUuid` makes this a tree, not a log.** Rewind and fork branch it. A reader treating it as a flat append-only list renders abandoned branches interleaved with live ones. **Decision:** v1 walks parents back from the newest leaf and shows that single path; the branch tree is a nice-to-have.
2. **`isSidechain` marks subagent turns.** Nest them under their parent; never inline them into the main transcript.

This is an internal, undocumented format — expect drift across CLI versions. **Mitigation:** treat JSONL strictly as *history backfill*. Live state always comes from the stream. Pin the CLI version in the image; gate replay behind a version check and degrade to "history unavailable for this version" rather than mis-rendering.

---

## 5. Container

```yaml
services:
  overseer:
    build: .
    ports: ["127.0.0.1:3000:3000"]
    volumes:
      - claude-home:/home/node/.claude    # container-owned; never bound to host
      - ./workspace:/work                 # the only shared surface
    environment:
      - CLAUDE_CONFIG_DIR=/home/node/.claude
volumes:
  claude-home:
```

One process: the Node server serves the built SPA as static files and handles `/api/*` + `/ws` on the same port. No reverse proxy for local use.

- `/work/<project>/` — one git project per directory. Session creation picks one; it becomes the process `cwd`.
- `/work/_overseer/` — import/export staging and the local SQLite store for usage, session index, and search.
- Image needs `git`, `ripgrep`, and a shell alongside Node; the CLI shells out to all three. `node-pty` for the auth flow. Run as non-root.
- Because `.claude` is container-owned, the previous draft's host/container config race is gone. The remaining overlap is `/work` itself: host-side git operations on a project while an agent writes to it. Normal git discipline covers it; the UI shows each session's `gitBranch` and dirty state so the conflict is at least visible.

---

## 6. Security

"Single-user, local" doesn't remove the problem:

- This is **remote code execution as a service**. Bind `127.0.0.1` explicitly. If it ever needs LAN access, put a token in front of it — not "it's on my network".
- Check `Origin` on the WebSocket upgrade. Otherwise any page in the user's browser can open a socket to `localhost:3000` and drive the agent.
- The container holds a live subscription token in `claude-home`. Any RCE inside it exfiltrates that token — which is also the argument for not mounting the host's `~/.claude`.
- `bypassPermissions` removes the last guard. Gate it behind an explicit server-side opt-in mirroring the CLI's own `--allow-dangerously-skip-permissions` gesture, and render it in `--danger` whenever active.

### 6.1 One thing to verify before building the approval queue

Does the CLI emit a `can_use_tool` control request on stdout under `--input-format stream-json`? The Agent SDK's `canUseTool` rides this same protocol, so it should — but confirm it before committing.

Fallback if not: a `PreToolUse` hook script that POSTs the tool call to the server and blocks on the HTTP response, returning `{"permissionDecision":"allow"|"deny"|"ask"}`. Either path gives the UI a human-in-the-loop gate; the difference is plumbing, and it's the one thing that would change the adapter's shape. **Resolve first.**

---

## 7. Sizing

- Budget ~500 MB–1 GB resident per *live* process — now per open session rather than per in-flight turn. Idle reaping (§1.2) is what keeps a handful of tabs from pinning gigabytes.
- The CLI has no built-in session timeout; enforce idle and turn limits server-side.
- `--max-budget-usd` is the cost-side equivalent of a timeout. Set a default.
