# Consoles and sessions — Behavioural Spec

Since `0.5.0` all agent work happens in a console: the provider CLI's own TUI, a plain shell, or a
dev-loop run, in a PTY the server owns ([architecture.md §1.2](../architecture.md#12-process-model--consoles-belong-to-the-server)).
How a console looks is [ui-ux.md §5.3](../ui-ux.md#53-the-console); this file is what it does.

---

## 1. Kinds

| Kind | Runs | Started from |
|---|---|---|
| `agent` | the attached provider's CLI, via the adapter's `consoleCommand` | `+ new session` in the left rail (signed-in provider only); a prompt typed into the prompt bar (it becomes the CLI's opening prompt); a dormant session row (resumes it) |
| `shell` | a login shell in the project | `+ shell`, `/shell` |
| `loop` | `/app/loop/run <project>` ([dev-loop.md](dev-loop.md)) | `/loop`, a loop session row |

A new console targets the **active project**; an existing one keeps its own. An `agent` console
carries a **callsign** and can be relayed to ([relay.md](relay.md)).

## 2. Opening — start or attach

Opening never starts a second process on something that already has one:

- **One CLI per transcript.** Opening a session that already has a running console shows that
  console instead of starting a second CLI on the same transcript.
- **A project's loop console** is likewise attached rather than started twice.
- **A loop run held elsewhere** (a terminal outside this server holds the project's lease) is
  only reachable by a take-over: a decision ([ui-ux.md §5.4](../ui-ux.md#54-the-decision--the-one-surface-that-blocks))
  asks first, because confirming ends that run. A session a live loop run holds is never resumed
  as an `agent` console.
- **Ids are minted up front** with the project directory and optional opening prompt, so a new
  console is linked to its session immediately. Codex prepares and names a native thread before
  launching `codex resume <id>`; preparation failure refuses the open, and spawning failure
  deletes that prepared thread. Concurrent opens on the same saved session join one open.

Before an `agent` console spawns Claude Code, Overseer marks the CLI's interactive onboarding
complete and trusts the project, so the TUI does not re-run the theme picker or browser login that
the providers window's sign-in already finished. Credentials are the shared container ones in
`agent-home` ([data.md §1](../data.md#1-where-things-live)).

## 3. Lifecycle

| Event | Result |
|---|---|
| close (✕) | **detach** — the process keeps running and stays in the session panel's list |
| kill (tab control, or the row's ■) | the process ends, and window and row go at once — a deliberate kill is never reported as a failure |
| CLI exits cleanly (`/exit`, `exit`) | the window closes and the console is dismissed |
| CLI fails | the window stays, with the exit code, so the failure can be read; the console stays listed until dismissed |
| tab reload | console windows reopen in their saved order and tile, with scrollback (512 × 1024 UTF-16 code-unit ring), once discovery is done |
| a second tab | attaches to the same consoles; resize is last-writer-wins |

Window ids and opening order are remembered per browser ([data.md §5](../data.md#5-browser-storage)); the
processes and scrollback are remembered by the server.

## 4. Activity

Each console carries one `Activity` ([ui-ux.md §3](../ui-ux.md#3-activity--the-one-status-vocabulary)):

- **Claude Code** reports through hooks (`SessionStart`, `UserPromptSubmit`, `Pre/PostToolUse`,
  `Stop`, and `Notification` on a permission prompt or elicitation dialog → `waiting`), posted to
  the loopback-only, per-console-token hook endpoint.
- **Every other CLI** is read from its output: output means `working`, two quiet seconds mean `idle`.

A console waiting on the operator becomes a signal in the overseer space, which opens that console
([overseer.md §2.2](overseer.md#22-signals)). Approvals themselves are answered in the CLI's TUI;
Overseer only points at them.

## 5. The session list

The session panel merges two sources: every console the server runs (any project), and the active
project's dormant sessions read from the providers' own transcripts by the session index
(rebuilt whenever a transcript changes, broadcast to every tab). Picking a console brings its
window back — which is how a detached console is found again; picking a dormant session resumes it
in a new console (`claude --resume`, `agent --resume`, `codex resume`). Agent rows lead with their callsign
([relay.md §6](relay.md#6-where-callsigns-show)).

## 6. Keyboard

While focus is in a terminal the keyboard is the CLI's: Overseer's own keys stand down, except
`Ctrl` + `` ` ``, which raises the next console and is how you leave ([ui-ux.md §7.1](../ui-ux.md#71-keys)).
