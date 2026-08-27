# loop — dev-loop CLI

A standalone command-line tool that runs development loops — feature
requests, fixes, changes — against a project living under `workspace/<name>/`
in this repo. It exists outside the main Overseer app on purpose: it uses
**only available system commands, bash scripts, a provider CLI (Claude Code
or Cursor Agent) plus that provider's command files, and plain files**
— no Node/TS, no database server, nothing routes through npm.
**It runs directly on the host for now**
Should be run inside docker and can be folded into the main app later without that
constraint changing what it already does.

## Usage

```sh
loop/run <workspace-name>
```

- `<workspace-name>` must already exist as a directory under `workspace/`.
- Prereqs: `jq` on PATH, plus the active provider's CLI authenticated
  (`claude` for `claude-code`, `agent` for `cursor`).
- `loop/run` is the single point of entry: it carries a request through
  every step that's actually built — `request` → `research` → `scope` — in
  one run, resuming an in-flight request from wherever it left off, or
  starting a fresh one if none is open. Plain bash, run directly in your own
  terminal (not a nested agent session) — each step's own foreground
  provider call (structuring, scoping) inherits that real terminal, exactly
  as if you'd invoked it by hand.
  - Fresh start: run it, type the request, finish with Ctrl-D (EOF); or
    non-interactively via `loop/run my-project --file path/to/request.txt`,
    or piped stdin.
  - `research` then runs automatically — fully headless, no input needed.
  - `scope` then grills you with up to 20 questions in the same terminal
    session and writes the decision record.
  - Once `scope` completes, it prints where the decision record landed
    (`plan`/`implement`/`verify`/`decide`/`commit`/`review` aren't
    implemented yet) and asks whether to start a new request for this
    workspace — `y` loops back to a fresh `request` step right away
    (`--file` is only ever consumed for the first request of a run, never
    reused); anything else exits. It's an actual loop: it keeps offering a
    new request until you decline.
  - Without `--id`, auto-picks the workspace's one open (not cleared)
    request; dies if there's more than one (pass `--id` to disambiguate).
    With `--id`, resumes that exact request regardless of its current
    step/status.
  - `request`, `research`, and `scope` used to also be separate
    `loop/bin/*` scripts for exercising one step in isolation while they
    were being built; once they stabilized, that added nothing `loop/run`
    couldn't already do on its own, so their logic now lives in
    `bin/lib/steps/{request,research,scope}.sh`, called directly by `loop/run`.

Which provider (CLI) runs each step is controlled by `loop/.provider`
(tracked, defaults to `claude-code`) or a one-off `LOOP_PROVIDER=<id>`
environment override. Use `loop/bin/provider` to list and pick one.

```sh
loop/bin/list [workspace-name]
loop/bin/clear <workspace-name> (--id <request-id> | --all) [--yes]
loop/bin/provider [<id>]
```

- `loop/bin/list` prints open (not yet cleared) requests and their current
  step/status — for one workspace, or every slug under `db/` if the name is
  omitted. Read-only; derives state from `index.jsonl` (see below), not a
  separate cache.
- `loop/bin/clear` deletes a request's raw/record/research files, after running
  that request's current step's teardown hook (see "Safe dismount" below).
  Requires `--id <id>` or `--all`, prints what it's about to delete, and
  asks for confirmation unless `--yes` is passed (mandatory in a
  non-interactive shell — there's no default-yes fallback). `index.jsonl`
  is never rewritten: clearing appends a `cleared` event rather than
  erasing the request's history. `memory.md` is never touched by `clear` —
  it outlives any single request.
- `loop/bin/provider` lists bundles under `loop/providers/` and writes the
  chosen id to `loop/.provider`. With no argument on a TTY it prompts; with
  `<id>` it sets that provider directly. `LOOP_PROVIDER` still overrides
  at runtime when set.

## The three-way file taxonomy

Everything this tool writes is exactly one of three kinds — no ad-hoc JSON
files:

| Kind | Format | What goes here |
|---|---|---|
| **Human intentions/decisions** | `.txt` | Verbatim, unedited human input — the raw request text now; later, a review/approve-or-reject decision |
| **Automated operation log** | `.jsonl` | Append-only record of what the automation *did* — one line per lifecycle event |
| **Everything else** | `.md` | Substantive, agent-authored content meant to flow forward as context for the next step in the chain — or double as material for a skill/subagent/command later |

Concretely, per request: `db/<slug>/raw/<id>.txt` (human), `db/<slug>/index.jsonl`
(automation log), `db/<slug>/requests/<id>.md` (the structured record),
now `db/<slug>/research/<id>.md` (the research report), and
`db/<slug>/scope/<id>.md` (the scope decision record).

One deliberate partial exception: `db/<slug>/memory.md` is also "everything
else" `.md`, but it doesn't flow forward to just *the next* step in the
chain — it flows forward to *every* future step and *every* future request
for that slug. It's a living document `research` reads and updates each run
(merging in new findings, not just appending), not a per-request artifact.

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
isn't. `scope` deliberately does *not* follow this dual-mode pattern — see
its own section below.

**A slash command instead of an inline prompt in the bash script.** The
structuring prompt lives at
`providers/claude-code/.claude/commands/structure-request.md`, versioned
and reviewable on its own, with its own frontmatter-declared tool scope
(`allowed-tools: Read, Write`) as a second, independent layer of the
minimal-tool-surface guarantee, on top of the CLI's own `--allowedTools`.
(Other providers keep their own command files inside their bundle.)

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
filesystem write is the request's own artifact(s), on paths bash chose. Bash
validates that write before it ever touches `index.jsonl` — and that check
is more than presence: `record_is_valid`/`research_is_valid`/`scope_is_valid`
cross-check `id`/`slug`/`submitted_at` (or `researched_at`/`request_ref`, or
`scoped_at`/`request_ref`/`research_ref`) against the values bash itself
already generated, not just that the fields are non-empty. Presence-only
checking once let a provider write a real request record with
`id`/`slug`/`submitted_at` shifted into each other's fields — non-empty, so
it passed, but wrong. The jsonl append is `flock`-serialized so two
concurrent `loop/run`/`loop/bin/clear` runs on the same slug can't
interleave — a file-locking concern, not something to hand an LLM tool call.

**Provider abstraction.** The tool must not hardcode a specific CLI into
orchestration. `bin/lib/providers.sh` loads a self-contained bundle from
`providers/<id>/` (manifest + `provider.sh` + that provider's config tree),
mirroring Overseer's own `AgentAdapter` split
(`packages/protocol/src/adapter.ts`) — an id string plus a small function
contract (`provider_check_available`, `provider_structure`,
`provider_research`, `provider_scope`) each provider implements.
**Invariant:** when a provider is active, LLM invocations use only that
bundle's config root (`PROVIDER_ROOT`) — never `loop/` root, never another
provider's tree. Real providers today: `claude-code` (`providers/claude-code/`,
CLI `claude`) and `cursor` (`providers/cursor/`, CLI `agent`). Overseer's
own "currently attached provider" state lives inside a Docker-only volume
unreachable from a host-side tool, so this tool tracks its own default in
the tracked `loop/.provider` file instead (defaults to `claude-code`).
Adding another provider means filling out `providers/<id>/` to the same
contract — no changes to `loop/run` or `bin/lib/steps/*.sh`. Run
`loop/bin/check-providers` to lint that provider-specific CLIs/config stay
inside their own bundles.

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

1. **request** — capture the raw human intent. *(built; HITL — interactive)*
2. **research** — explore the codebase, write a context report for `scope`,
   and update the shared memory file. *(built; automated — one-shot)*
3. **scope** — bound what this iteration will actually do: an agent reads
   the request record and research report, then grills the human with up to
   20 questions (important design questions first, best-practice defaults
   for small doubts, a recommendation offered whenever it presents options)
   and writes a decision record. *(built; HITL — interactive. The rest below
   are spec-only, not built)*
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
behind a one-shot call. `scope` is the opposite end of that spectrum: a real
multi-turn conversation is the entire point of the step, capped at 20
questions (a ceiling, not a quota — it stops as soon as the important
questions are resolved). `research`, `plan`, `implement`, `verify`, and
`decide` are automated, so each runs as a single headless `claude -p` call
(or plain bash) with a fixed input/output contract and no human watching.
This lines up exactly with the inner-loop boundary above: everything inside
the closed loop, plus the `research` that feeds it, is headless; everything
at its edges (`scope` in, `commit` out) plus the two endpoints (`request`,
`review`) runs in the open.

**Why `scope` has no headless fallback.** `request` falls back to a `claude
-p` one-shot when there's no terminal attached, because its structuring pass
is deterministic — there's nothing conversational about it, so a scripted
caller can supply the raw text and get the same result. `scope` has no such
fallback: grilling the human *is* the step. `loop/run` checks for a TTY
before it does anything and dies with a clear message if one isn't
attached, rather than silently downgrading to a call with no one to answer
its questions.

"**Phase**" is a different, more granular concept reserved for *inside* a
`plan` — a plan decomposes work into phases — and isn't designed yet.

**One command per step.** Each step is meant to be executed by its own
behavior and instructions, under the active provider's commands tree
(for claude-code: `providers/claude-code/.claude/commands/<step>/`),
documenting/enforcing how that step runs. This is a noted extension point:
`request`, `research`, and `scope` are the only steps built so far, and
today they run as flat slash commands
(`structure-request.md`, `research-request.md`, `scope-request.md`)
rather than in `<step>/` subdirectories.

Each step reuses the same taxonomy: human input/decisions stay `.txt`,
automation logs its actions to `index.jsonl`, and any new substantive content
it produces is `.md` — additive, feeding forward as context for the next
step in the chain.

**Safe dismount.** `loop/bin/clear` deletes a request's files, but some steps
will leave something behind first — `implement`'s `--add-dir
workspace/<name>` mount, a tracked subagent process, a git worktree —
that needs releasing before deletion is safe. `bin/lib/steps.sh` dispatches to
an optional `bin/lib/steps/<step>.sh` defining `step_teardown_hook <slug> <id>`,
mirroring the provider abstraction above; a step with nothing to release
just doesn't define one. `bin/lib/steps/{request,research,scope}.sh` each
hold two things: the step's actual logic (`step_request`/`step_research`/
`step_scope`, called directly by `loop/run`) and that step's teardown hook —
kept together since they're the same step, per the provider/step-id
convention the rest of the tool follows. `request`, `research`, and `scope`
are all synchronous and stateless (their `claude`/interactive calls fully
return before `loop/run` continues, and none of them leaves anything
mounted or running), so all three hooks are no-ops.
