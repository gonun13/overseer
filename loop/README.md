# loop — dev-loop CLI

A standalone command-line tool that runs development loops — feature
requests, fixes, changes — against a project living under `workspace/<name>/`
in this repo. It exists outside the main Overseer app on purpose: it uses
**only available system commands, bash scripts, the Claude Code CLI / slash-commands, and plain files**
— no Node/TS, no database server, nothing routes through npm. 
**It runs directly on the host for now** 
Should be run inside docker and can be folded into the main app later without that
constraint changing what it already does.

## Usage

```sh
loop/request <workspace-name>
```

- `<workspace-name>` must already exist as a directory under `workspace/`.
- Prereqs: `claude` CLI on PATH and authenticated, `jq` on PATH.
- Interactive: run it, type the request, finish with Ctrl-D (EOF).
- Scripted: `loop/request my-project --file path/to/request.txt`, or pipe
  stdin (`printf '...' | loop/request my-project`).
- On success it prints the request id, title, and the record's path.

Which provider (CLI) runs the structuring step is controlled by
`loop/.provider` (tracked, defaults to `claude-code`) or a one-off
`LOOP_PROVIDER=<id>` environment override.

```sh
loop/list [workspace-name]
loop/clear <workspace-name> (--id <request-id> | --all) [--yes]
```

- `loop/list` prints open (not yet cleared) requests and their current
  step/status — for one workspace, or every slug under `db/` if the name is
  omitted. Read-only; derives state from `index.jsonl` (see below), not a
  separate cache.
- `loop/clear` deletes a request's raw/record files, after running that
  request's current step's teardown hook (see "Safe dismount" below).
  Requires `--id <id>` or `--all`, prints what it's about to delete, and
  asks for confirmation unless `--yes` is passed (mandatory in a
  non-interactive shell — there's no default-yes fallback). `index.jsonl`
  is never rewritten: clearing appends a `cleared` event rather than
  erasing the request's history.

## The three-way file taxonomy

Everything this tool writes is exactly one of three kinds — no ad-hoc JSON
files:

| Kind | Format | What goes here |
|---|---|---|
| **Human intentions/decisions** | `.txt` | Verbatim, unedited human input — the raw request text now; later, a review/approve-or-reject decision |
| **Automated operation log** | `.jsonl` | Append-only record of what the automation *did* — one line per lifecycle event |
| **Everything else** | `.md` | Substantive, agent-authored content meant to flow forward as context for the next step in the chain — or double as material for a skill/subagent/command later |

Concretely, per request: `db/<slug>/raw/<id>.txt` (human), `db/<slug>/index.jsonl`
(automation log), `db/<slug>/requests/<id>.md` (the structured record).

No separate cache is kept to answer "what step is this request on" — that
would be a fourth file kind, breaking the taxonomy above. The record's own
frontmatter (`status`, `step`) is a single, already-there file read; and
because `index.jsonl` is append-only, the last line for a given `id` is
always its current state without needing anything mutated in place.

## Why it's built this way

**Interactive when there's a human to watch, headless when there isn't.**
`request`'s intent-capture half is plain stdin, not a `claude` session —
there's no agent to converse with yet at that point, and the human already
sees what they typed. Structuring that text used to happen entirely behind
a hidden one-shot call; now, whenever a terminal is attached, it runs as a
real foreground `claude` session so the human watches the Read/Write happen
live instead of waiting on a black box. The one-shot `claude -p` path still
exists as a fallback for scripted/piped invocations (`--file`, piped stdin)
where there's no terminal to attach to and no one to watch anyway — that
path stays cheap, scriptable, and testable the way an interactive session
isn't.

**A slash command instead of an inline prompt in the bash script.** The
structuring prompt lives at `.claude/commands/structure-request.md`, versioned
and reviewable on its own, with its own frontmatter-declared tool scope
(`allowed-tools: Read, Write`) as a second, independent layer of the
minimal-tool-surface guarantee, on top of the CLI's own `--allowedTools`.

**Markdown records instead of JSON.** A markdown file is directly usable as
LLM context with zero parsing — a later step can `Read` it straight into a
prompt, or copy sections of it into a skill/command file. JSON would need a
parse step first, and it doesn't fit the "everything else is markdown"
taxonomy above. Frontmatter carries the few fields that need to stay
structured (`id`, `status`, `step`, …), using the same tolerant, line-based
convention `packages/adapters/claude-code/src/custom-agents.ts` already uses
for `.claude/agents/*.md` — no YAML library.

**Centralized `db/` instead of writing into the workspace.** Workspace
directories are the *target* the tool acts on — each is its own
independently git-managed project. The loop tool's own bookkeeping must never
be mistaken for project source or accidentally committed into someone's app
repo.

**Bash — not the provider — commits the log.** The provider call's only
filesystem write is the one request record, on paths bash chose. Bash
validates that write (file exists, required frontmatter present, has a
title) before it ever touches `index.jsonl`, and the jsonl append is
`flock`-serialized so two concurrent `loop/request` runs on the same slug
can't interleave — a file-locking concern, not something to hand an LLM tool
call.

**Provider abstraction.** The tool must not hardcode `claude`. `lib/providers.sh`
+ `lib/providers/<id>.sh` mirror the shape of Overseer's own `AgentAdapter`
split (`packages/protocol/src/adapter.ts`) — an id string plus a small
function contract (`provider_check_available`, `provider_structure`)
each provider implements. Only `claude-code` is real today, matching
Overseer's own real-vs-stub balance (`codex`/`opencode`/`github-copilot` are
catalog names with no adapter code anywhere in that app either). Overseer's
own "currently attached provider" state lives inside a Docker-only volume
unreachable from a host-side tool, so this tool tracks its own default in the
tracked `loop/.provider` file instead. Adding a second real provider later
means writing `lib/providers/<id>.sh` implementing the same two functions —
no changes to `loop/request`.

**Context-window discipline (smart zone / dumb zone).** LLM attention over a
single context window is uneven: instructions near the very start and very
end get followed reliably; content buried in the middle is where instruction
following and recall degrade ("lost in the middle"). This tool keeps bulk
content out of prompt bodies — the raw request is written to a file first and
passed as a *path* for the provider to `Read`, never inlined — and sandwiches
critical constraints (stated once right after a command's frontmatter, then
restated in one line right before the step that acts on them) rather than
stating them only once. Later steps that assemble larger single-shot
contexts should follow the same rule: task instruction and required output
contract at both ends of the prompt, reference material by path wherever
possible.

## Steps

The loop is made of nine **steps**, in order:

1. **request** — capture the raw human intent. *(built; HITL — interactive.
   The rest below are spec-only, not built)*
2. **research** — gather the context needed to scope the work. *(automated
   — one-shot)*
3. **scope** — bound what this iteration will actually do. *(HITL —
   interactive)*
4. **plan** — decide how to do it. *(automated — one-shot)*
5. **implement** — do it. *(automated — one-shot)*
6. **verify** — check it. *(automated — one-shot)*
7. **decide** — judge the result of `verify` and route: loop back to
   `plan`, break out to `scope` for more scoping, or break out to `commit`.
   *(automated — one-shot)*
8. **commit** — commit the work. *(HITL — interactive)*
9. **review** — final human review. *(HITL — interactive)*

**The inner loop.** `plan` → `implement` → `verify` → `decide` (4-7) is a
closed automated loop — no human in it. The only two ways out are `decide`
routing back to `scope` (3, for extra scoping) or forward to `commit` (8).
Every other step-to-step handoff is a straight, one-directional pass.

**HITL vs automated execution.** `request`, `scope`, `commit`, and `review`
are human-in-the-loop, so each runs as a real foreground `claude` session —
the human watches, and can act, because the work touches a person's
judgment or context. That doesn't mean every one is a back-and-forth
conversation: `request`'s structuring stays a single deterministic pass
(one Read, one Write, no follow-up questions) — it's just no longer hidden
behind a one-shot call. `research`, `plan`, `implement`, `verify`, and
`decide` are automated, so each runs as a single headless `claude -p` call
(or plain bash) with a fixed input/output contract and no human watching.
This lines up exactly with the inner-loop boundary above: everything inside
the closed loop, plus the `research` that feeds it, is headless; everything
at its edges (`scope` in, `commit` out) plus the two endpoints (`request`,
`review`) runs in the open.

"**Phase**" is a different, more granular concept reserved for *inside* a
`plan` — a plan decomposes work into phases — and isn't designed yet.

**One command per step.** Each step is meant to be executed by its own
behavior and instructions, at `loop/.claude/commands/<step>/`, documenting/enforcing how
that step runs. This is a noted extension point: `request` is the only step
built so far, and today it runs as a slash command
(`.claude/commands/structure-request.md`).

Each step reuses the same taxonomy: human input/decisions stay `.txt`,
automation logs its actions to `index.jsonl`, and any new substantive content
it produces is `.md` — additive, feeding forward as context for the next
step in the chain.

**Safe dismount.** `loop/clear` deletes a request's files, but some steps
will leave something behind first — `implement`'s `--add-dir
workspace/<name>` mount, a tracked subagent process, a git worktree —
that needs releasing before deletion is safe. `lib/steps.sh` dispatches to
an optional `lib/steps/<step>.sh` defining `step_teardown_hook <slug> <id>`,
mirroring the provider abstraction above; a step with nothing to release
just doesn't define one. `request` is synchronous and stateless, so its
hook (`lib/steps/request.sh`) is a no-op.
