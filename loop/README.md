# loop — dev-loop CLI

A standalone command-line tool that runs development loops — feature requests,
fixes, changes — against a project living under `workspace/<name>/` in this
repo. It exists outside the main Overseer app on purpose: it uses **only
available system commands, bash scripts, a provider CLI (Claude Code or Cursor
Agent), and plain files** — no Node/TS, no database server, nothing routes
through npm. **It runs directly on the host for now.** It should run inside
Docker, and can be folded into the main app later without that constraint
changing what it already does.

## Usage

```sh
loop/run <workspace-name>
```

That opens an **overseer** — an interactive session on the configured provider
agent — and hands it your terminal. The overseer is the loop: it reads what is
open for that workspace, resumes a request that is mid-flight, offers to plan
one already scoped, or asks you for a new one when nothing is pending, and
keeps going until you stop it. You talk to it; it runs the steps.

- `<workspace-name>` must already exist as a directory under `workspace/`.
- Prereqs: `jq` on PATH, plus the active provider's CLI authenticated
  (`claude` for `claude-code`, `agent` for `cursor`).
- An interactive terminal is required — the overseer needs to talk to you.
- One overseer per workspace at a time. `loop/run` takes a session lease so a
  second terminal is told who holds it rather than racing; `loop/bin/list`
  shows it too.

Which provider runs the overseer is controlled by `loop/.provider` (local,
gitignored; defaults to `claude-code` when absent) or a one-off
`LOOP_PROVIDER=<id>` environment override. Use `loop/bin/provider` to list and
pick one.

## The commands

`loop/run` is the only thing you normally type. Everything else is the small,
deterministic surface the overseer drives — and you can run any of it yourself
to inspect or repair state without starting a session.

```sh
loop/bin/list [<workspace-name>] [--json]
loop/bin/new <workspace-name>                     # raw request text on stdin
loop/bin/step <workspace-name> <request-id> <step> [--tracer <ids>]
loop/bin/record <workspace-name> <request-id> <step>
loop/bin/tracers <workspace-name> <request-id> [--json | --next | --last]
loop/bin/phase <workspace-name> [--release] [--yes] [--force]
loop/bin/clear <workspace-name> (--id <request-id> | --all) [--yes]
loop/bin/provider [<id>]
loop/bin/check
```

| Command | What it does |
|---|---|
| `list` | Open (not yet cleared) requests and their current step/status, for one workspace or every slug under `db/`. Read-only, derived from `index.jsonl` plus, for a request that has been `decided`, the `route` from its decision record. `--json` adds the session lease and the exclusive-phase lock, and is the form the overseer reads. |
| `new` | Allocates a request id, writes the raw human text to `db/<slug>/raw/<id>.txt` verbatim, and prints the `request` step context. Nothing is recorded until `record` runs, so a failed structuring pass can't lose what the human said. |
| `step` | Prints one step's context: the instruction file to follow, the inputs to read, the file to write, and the exact frontmatter to put in it. Refuses if an input artifact is missing. For a step that takes the working tree it also claims the exclusive-phase lock, and refuses if another request holds it; `--tracer` names which slice of the plan to work. |
| `record` | Validates what the step wrote against the frontmatter `step` handed out, then appends the step's event to `index.jsonl`. On failure it records nothing and prints which keys are wrong. A step that takes the working tree must still hold the lock. Recording a `decide` whose route is not `commit` also clears that lock's record of the lap just finished, which is what lets the cycle turn again. |
| `tracers` | That request's tracers, from its plan, with the phase they belong to, whether the plan declared them parallel, and their status from the implement record's ledger. `--next` prints just the group to implement next, comma-separated and ready for `step --tracer`; `--last` prints the group the implement record says was actually built, which is what `verify` checks and what a rework redoes. Read-only, and the only place plan markdown is parsed. |
| `phase` | Reports who holds the exclusive phase, how far through the current lap of the cycle they are, and which tracers are pending. `--release` hands the phase back — an administrative hatch for a human cleaning up outside a session, refused while the holder still has pending tracers unless `--force`, and never a statement that a run was good. Changes nothing else — no artifact, no status, no `index.jsonl` line. |
| `clear` | Deletes a request's artifacts and appends a `cleared` event. Requires `--id` or `--all`, prints what it's about to delete, and asks for confirmation unless `--yes` (mandatory in a non-interactive shell). `index.jsonl` is never rewritten; `memory.md` is never touched. Releases the lock if the cleared request held it. |
| `provider` | Lists bundles under `providers/` and writes the chosen id to `loop/.provider`. `LOOP_PROVIDER` still overrides at runtime. |
| `check` | The lint gate: bash syntax, shellcheck (from PATH, or its container image), and `check-providers`. |

Each takes `--help`.

## Why it's built this way

**The agent runs the loop; bash standardizes the touchpoints.** An agent can
already run shell commands, read files, ask questions, and spawn subagents.
Rebuilding that as a bash state machine — resume logic, step dispatch, "plan
another?" prompts — meant maintaining an orchestrator that was worse at
orchestrating than the thing it was orchestrating. So the control flow moved
into the overseer, and bash kept the parts a language model should never
improvise: allocating ids and paths, stamping timestamps, validating what got
written, and appending to the log. Nothing in `bin/` decides what happens next.

**No headless mode.** There is no `--file`, no piped-stdin request, no one-shot
call path. Every one of those was a second implementation of a step that had to
be kept in sync with the first, and each existed to serve a scripted caller
that never arrived. If you want to script something here, call the verbs
directly — they are the scriptable interface, and they are the same ones the
overseer uses.

**Step instructions are provider-neutral.** `steps/<step>.md` describes what a
step does, once, for every provider. They used to be per-provider slash
commands, which meant the same 250-line scope prompt existed twice, diverging
each time either copy was edited. What genuinely differs between providers —
which CLI, which flags, which permissions file — is the entire content of a
provider bundle, and it is about 40 lines.

**Named context, not positional arguments.** A step is handed one JSON object
naming every path and frontmatter value it needs. Passing them positionally
meant 13- and 14-argument bash functions and prompts asking a model to copy
`$4` through `$14` into the right fields — which failed in both directions:
`local plan_file=$10` is `${1}0` in bash, not `${10}`, and a model reading
`$10` makes exactly the same mistake. `frontmatter` in the context is the
literal block to copy, and `record` checks the result against the same values.

**Bash — not the provider — commits the log.** A step's only filesystem write
is its own artifact, on a path bash chose. `loop/bin/record` validates that
write before `index.jsonl` is touched, and the check is more than presence:
every value bash can independently derive from the workspace, id, and step —
the id, the slug, the workspace, the status, and every `*_ref` — is compared,
not just counted. Presence-only checking once let a provider write a record
with `id`/`slug`/`submitted_at` shifted into each other's fields: non-empty, so
it passed, but wrong. The jsonl append is `flock`-serialized so two concurrent
commands on the same slug can't interleave — a file-locking concern, not
something to hand a model a tool call for.

**Centralized `db/` instead of writing into the workspace.** Workspace
directories are the *target* the tool acts on — each is its own independently
git-managed project. The loop tool's own bookkeeping must never be mistaken for
project source or accidentally committed into someone's app repo.

**Context-window discipline (smart zone / dumb zone).** Attention over a single
context window is uneven: instructions near the very start and very end get
followed reliably; content buried in the middle is where instruction-following
and recall degrade. So bulk content stays out of prompt bodies — the raw
request is written to a file first and passed as a *path*, never inlined — and
critical constraints are stated near the top and restated right before the step
that acts on them. The overseer gets the same treatment from the other side:
its whole job is to not read things, delegating any step it can to a subagent
so the artifacts never enter its window at all.

## The three-way file taxonomy

Everything this tool writes is exactly one of three kinds — no ad-hoc JSON
files:

| Kind | Format | What goes here |
|---|---|---|
| **Human intentions/decisions** | `.txt` | Verbatim, unedited human input — the raw request text now; later, a review/approve-or-reject decision |
| **Automated operation log** | `.jsonl` | Append-only record of what the automation *did* — one line per lifecycle event |
| **Everything else** | `.md` | Substantive, agent-authored content meant to flow forward as context for the next step — or double as material for a skill/subagent/command later |

Concretely, per request: `db/<slug>/raw/<id>.txt` (human), `db/<slug>/index.jsonl`
(automation log), and one `.md` per completed step —
`db/<slug>/requests/<id>.md`, `research/<id>.md`, `scope/<id>.md`,
`plan/<id>.md`, `implement/<id>.md`, `verify/<id>.md`, `decide/<id>.md`. Two
per-slug files are automation state rather than a fourth taxonomy kind:
`db/<slug>/running.json` (the overseer session's pid and start time) lets
concurrent terminals see that a workspace is being driven, and
`db/<slug>/implement.lock` (two lines: the request id that owns the working
tree, and which exclusive steps have recorded on the current lap of the cycle)
says who holds the phase and how far through a lap they are. Neither is a record
of anything that happened — that is what `index.jsonl` is for.

Three files are still "everything else" `.md` but do not flow forward to just
*the next* step, because the inner loop runs more than once:

- `db/<slug>/memory.md` flows forward to *every* future step and *every* future
  request for that slug. It's a living document `research` reads and rewrites
  each run, not a per-request artifact, so it has no frontmatter and `clear`
  never touches it.
- `implement/<id>.md` is **rewritten** each run, cumulatively: its tracer ledger
  must always describe the whole plan, so the newest write is the whole truth.
- `decide/<id>.md` is **appended** to, once per lap: each `## Decision` block
  stays exactly as it was written, and the frontmatter's `route` mirrors the
  last one. The sequence is the point — it is how `decide` knows it has already
  sent the same tracer group back for rework twice, and how a restarted
  overseer sees the same. Rewriting it would destroy the only record of that.

No separate cache is kept to answer "what step is this request on" — that would
be a fourth file kind. Because `index.jsonl` is append-only, the last line for a
given `id` is always its current state.

**Markdown records instead of JSON.** A markdown file is directly usable as LLM
context with zero parsing — a later step can read it straight into a prompt, or
copy sections of it into a skill or command file. Frontmatter carries the few
fields that need to stay structured (`id`, `status`, `step`, …), using the same
tolerant, line-based convention
`packages/adapters/claude-code/src/custom-agents.ts` already uses for
`.claude/agents/*.md` — no YAML library.

## Steps

The loop is made of nine **steps**, in order:

1. **request** — capture the raw human intent and structure it into a record.
   *(built)*
2. **research** — explore the codebase, write a context report for `scope`, and
   update the shared memory file. *(built)*
3. **scope** — bound what this iteration will actually do: read the request and
   the research, grill the human with up to 20 questions (important design
   questions first, best-practice defaults for small doubts, a recommendation
   offered whenever options are presented), and write a decision record.
   *(built)*
4. **plan** — decide how to do it: decompose scope into layers, phases, and
   independently verifiable vertical tracers; write one `plan/<id>.md` with an
   `impact` score. *(built)*
5. **implement** — do it: build one vertical tracer of the plan, test-first
   where the project allows it, and write one cumulative record whose tracer
   ledger says what is done. *(built)*
6. **verify** — check it: run the project's own tests, run its own lints, drive
   the change the way a user would, and write down what happened — without
   judging it and without stopping at the first red result. *(built)*
7. **decide** — judge that lap and route it: another tracer group, a rework of
   the same one, back to `plan`, out to `scope`, or forward to `commit`. One
   append-only decision record per request. *(built)*
8. **commit** — commit the work. *(spec-only — not built)*
9. **review** — final human review. *(spec-only — not built)*

**The inner loop.** `plan` → `implement` → `verify` → `decide` (4-7) is a closed
automated loop with no human in it. `decide` is the only thing that says where
a request goes next, and it writes that as a `route` its record carries:

| `route` | Where the request goes |
|---|---|
| `implement` | the next pending tracer group — the common case |
| `rework` | the same group again, with a directive saying what to do differently |
| `plan` | back to `plan` (4): the decomposition itself was wrong |
| `scope` | back to `scope` (3), the one route that puts the human back in |
| `commit` | forward to `commit` (8) |

Everything but `scope` and `commit` keeps the request inside the cycle. Every
other step-to-step handoff in the loop is a straight, one-directional pass.

**Who runs a step.** Only one thing decides this: whether the step needs the
human — with one addition, because routing is the overseer's own job. `scope` is
a real conversation, so the overseer runs it in its own session; the human is
already talking to that session, and no subagent can take over the conversation.
`decide` it also runs itself: the decision of what happens next is the one thing
the overseer must not delegate, and the two records it reads are telegraphic by
design and bounded by `steps/decide.md`. `request`, `research`, `plan`,
`implement` and `verify` need nobody, so each goes to a subagent that reads its
instruction file, does the work, and reports one line back. That is what keeps
the overseer's window on the state of the loop instead of on the contents of the
artifacts.

**The exclusive phase.** `implement`, `verify` and `decide` take the project's
working tree, so one request may be in there at a time — two of them editing
the same tree produces a conflict nobody can untangle afterwards. Bash owns
that rule rather than the overseer's good intentions: `loop/bin/step` claims
`db/<slug>/implement.lock` before handing over the context and refuses when
another request holds it; `loop/bin/record` refuses to record a step whose
claim has gone. The lock deliberately outlives the session, so a restarted
overseer finds the request still holding the tree.

A request holds it for the whole of its stay in the cycle, not for one lap:
`decide` turns the cycle without ever handing the tree back, because the
changes are still there and still that request's. `commit` is what would end
the phase, and `commit` is not built — so a request `decide` routes to `commit`
keeps the tree and the workspace **halts**. The overseer says why and offers to
exit. `loop/bin/phase --release` and `loop/bin/clear` are the administrative
ways out, and neither is a statement that the work was good.

**One lap at a time.** `plan` → `implement` → `verify` → `decide` is a cycle,
so running `implement` twice before anything checked the first would stack two
unjudged changes in the same working tree. `loop/bin/step` refuses it, exit 3:
`loop/bin/record` notes each exclusive step it commits on the lock's second
line, and a claim that has already recorded a step cannot start it again — it
is told which step comes next instead. `decide` then clears that line, and the
same request may run `implement` → `verify` → `decide` again. The marker lives
on the *claim*, not on the request, so a run whose `record` failed — nothing
committed, so nothing marked — is still retryable, and releasing the phase
clears the slate.

The one thing that does not clear is a `decide` that routed to `commit`: the
phase is being handed on, and re-running `decide` would only re-judge work
already judged. That is the halt, and it is the loop working, not a fault to
route around. The operator is never asked to adjudicate a lap either — the
cycle is closed and automated, so a human standing in for `verify` or `decide`
would just be a built step wearing a hat.

**One tracer *group* per `implement` run.** The plan already decomposed the
work into tracers that are independently implementable and verifiable, so that
is the slice — but a plan also declares which same-phase tracers are
`parallel: true`, meaning it checked that they own disjoint files. Those go to
one run together: a phase of seven parallel tracers is one dispatch, not seven.
A tracer that is not parallel runs alone, and a group never spans phases —
phases exist precisely because the later one depends on the earlier being
finished.

`loop/bin/tracers <ws> <id> --next` computes the group: every pending parallel
tracer of the lowest unfinished phase, or the single next pending tracer when
it is not parallel. That rule lives in bash rather than in the overseer's
judgement, and it is what the overseer passes to `loop/bin/step --tracer`.

`implement/<id>.md` is cumulative: it is rewritten each run with a ledger of
every tracer in the plan and its status, which is how the next run — or a
restarted overseer — knows what is already done. It is one file per request, so
one run writes it; that is why a parallel group is batched into a single run
rather than fanned out across several that would clobber each other's ledger.

**Adding a step.** Two things: a row in the `LOOP_STEPS` table at the top of
`bin/lib/db.sh` and a `steps/<step>.md` next to the others. The row is the
whole declaration — its directory, the status it lands in, its timestamp key,
which earlier artifacts it must reference, any extra frontmatter it owns
(free text, an integer, or a value from a fixed set), and any artifact it
should be handed *if it exists* without being blocked when it doesn't. Paths,
refs, the step context, validation, `ensure_slug_dirs`, and `clear`'s deletion
list all derive from it. `loop/bin/check` fails if a step has no instructions,
or instructions no step. A step that takes the project's working tree is also
named in `LOOP_EXCLUSIVE_STEPS`, one line below the table — that is the whole
of what makes `verify` and `decide` share `implement`'s lock.

Two of those column kinds exist because the inner loop is a cycle rather than a
line. A fixed-value column is what lets bash reject a `decide` route it could
not act on, before the event is committed — the overseer must never be handed a
routing instruction that is not one of the five. An optional-artifact column is
what carries a `decide` directive into the *next* `implement` run: making it a
required reference would mean the first `implement` could never start, since
nothing has decided anything yet.

### Plan decomposition (inside a `plan`)

A plan evaluates the scoped work and writes **one** `db/<slug>/plan/<id>.md`:

| Term | Meaning |
|---|---|
| **Horizontal layer** | Architectural stratum this request touches (named from the real codebase). |
| **Vertical layer** | Cross-cutting concern that forces sequencing — only when it matters. |
| **Phase** | Ordered batch that should be done/verified before the next depends on it. |
| **Vertical tracer** | Thin end-to-end slice through horizontals; independently implementable/verifiable (`p1.t1` ids). |

Layers = map; tracers = routes; phases = waves. Prefer few phases. Same-phase
tracers may set `parallel: true` only with disjoint file ownership — `plan`
does not act on it, but `implement` does: `loop/bin/tracers --next` batches a
phase's parallel tracers into one run, so a wrongly-declared `parallel: true`
is what puts two colliding tracers in the same run. Frontmatter includes
planner-owned `impact` (integer >= 1, lower = smaller blast radius) and
`phase_count`.

## Providers

The tool must not hardcode a specific CLI. `bin/lib/providers.sh` loads a
self-contained bundle from `providers/<id>/` (a manifest, `provider.sh`, and
that provider's own config tree), mirroring Overseer's own `AgentAdapter` split
(`packages/protocol/src/adapter.ts`) — an id string plus a function contract.
Here the contract is two functions, because a provider's whole job is to open
one session:

```
provider_check_available
provider_session <prompt> <workspace_dir>
```

**Invariant:** when a provider is active, the session's config discovery sees
only that bundle's config root (`PROVIDER_ROOT`) — never `loop/` root, never the
repo's own config, never another provider's tree.

Real providers today: `claude-code` (`providers/claude-code/`, CLI `claude`) and
`cursor` (`providers/cursor/`, CLI `agent`). Overseer's own "currently attached
provider" state lives inside a Docker-only volume unreachable from a host-side
tool, so this tool keeps its own default in `loop/.provider` instead.

Adding another provider means filling out `providers/<id>/` to that contract —
no changes to `loop/run`, to `bin/`, or to any step's instructions.
`loop/bin/check` lints it: a provider's CLI name and config directory must not
appear in orchestration (which includes `overseer.md` and `steps/*.md`, since
every provider reads those) or in another bundle, and every bundle must define
the contract and carry a non-empty config directory.

**Providers are not equally capable, and the loop degrades rather than
branches.** `overseer.md` and `steps/*.md` state a fallback for each gap, so the
same instructions run everywhere — just less comfortably on a thinner CLI.
Today `cursor` is the thinner one:

- **Subagents.** The overseer delegates `request`, `research`, `plan`,
  `implement` and `verify` so their artifacts never enter its window. Without a
  way to spawn one, it runs the step itself — correct, but it pays the
  context.
- **Structured questions.** Choices put to the operator — which request to
  resume, which scope to plan, a scoping question with discrete options — fall
  back to a numbered list answered with a number.

**The tool grant is sized for the widest step, not the overseer.** The overseer
itself only runs the loop's own commands, spawns subagents, and asks the human
questions. `implement` edits the project in place and runs the project's own
test command; `verify` runs its tests, its lints, and the change itself. A
subagent inherits whatever the session holds — so there is no narrower way to
grant them those tools than to grant them to the session. In-place edits and an
unprefixed shell are therefore allowed, where they used to be denied.

Three things bound that, and none of them is the permission system. A deny list
in each bundle's config keeps the irreversible verbs out (`rm`, `sudo`,
`git commit`, `git push`) — committing is a later step, and a human wants to see
an uncommitted diff. `overseer.md` states, as a standing rule, that only an
`implement` subagent may change a file under the workspace — `verify` runs the
project but never edits it, and the overseer never writes code itself. And a human watches the entire session — which was not true
of the headless per-step calls this replaced, and is the reason the widened
grant is acceptable at all. The `cursor` bundle's config carries no deny list
today, because its CLI's deny syntax is not something this repo has confirmed;
`--force` plus the watching human is all that bounds it there.
