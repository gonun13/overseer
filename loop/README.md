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
./bin/loop <workspace-name>
```

That opens an **overseer** — an interactive session on the configured provider
agent — and hands it your terminal. The overseer is the loop: it reads what is
open for that workspace, resumes a request that is mid-flight, offers to plan
one already scoped, or asks you for a new one when nothing is pending, and
keeps going until you stop it. You talk to it; it runs the steps.

**It runs in Overseer's container, not on your machine.** The session holds
`Write`, `Edit` and an unprefixed shell, and the `implement` step uses all
three on your project — so `loop/run` refuses to start on the host and points
you at `./bin/loop`, which opens the session inside the running stack. The loop
and the app share that container deliberately: one workspace, one provider
registry, one set of signed-in CLIs. The `loop/bin/*` commands below are not
guarded — they read and record state and open no session, so they work from a
host terminal too.

- `<workspace-name>` must already exist as a directory under `workspace/`.
- Prereqs: Docker, and the active provider's CLI signed in. Everything else the
  loop needs — `jq`, `flock`, `git`, the provider CLIs — is in the image.
  Sign in once, from either the app or here; they share the auth volume.
- An interactive terminal is required — the overseer needs to talk to you.
- One overseer per workspace at a time. `loop/run` takes a session lease so a
  second terminal is told who holds it rather than racing; `loop/bin/list`
  shows it too.
- `loop/bin/publish` pushes the branch to origin, which needs an ssh key the
  container does not have by default. `land` commits locally and nothing leaves
  the machine; generate a key in settings › git access to change that. Opening
  the pull request is yours to do, on whichever forge the remote lives on.

Anything under `loop/bin/` can be run the same way — `./bin/loop list personal`
reads what is open without starting a session.

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
loop/bin/stint <workspace-name> [--release] [--yes] [--force]
loop/bin/memory <workspace-name> --show | --merge [--id <id>] | --decision
loop/bin/land <workspace-name> <request-id> [--dry-run]
loop/bin/publish <workspace-name> <request-id> [--dry-run] [--force]
loop/bin/train <workspace-name> [--json | --tip] [--id <request-id>]
loop/bin/worktree <workspace-name> <request-id> (--create|--remove|--path)
loop/bin/signoff <workspace-name> <request-id>    # decision text on stdin
loop/bin/close <workspace-name> <request-id> [--merge] [--abandon] [--yes]
loop/bin/clear <workspace-name> (--id <request-id> | --all) [--yes]
loop/bin/provider [<id>]
loop/bin/check
```

| Command | What it does |
|---|---|
| `list` | Open (not yet cleared) requests and their current step/status, for one workspace or every slug under `db/`. Read-only, derived from `index.jsonl` plus, for a request that has been `decided`, the `route` from its decision record. `--json` adds the session lease and the stint's lock, and is the form the overseer reads. |
| `new` | Allocates a request id, writes the raw human text to `db/<slug>/raw/<id>.txt` verbatim, and prints the `request` step context. Nothing is recorded until `record` runs, so a failed structuring pass can't lose what the human said. |
| `step` | Prints one step's context: the instruction file to follow, the inputs to read, the file to write, and the exact frontmatter to put in it. Refuses if an input artifact is missing. For a step that takes the working tree it also claims the stint, and refuses if another request holds it; `--tracer` names which slice of the plan to work. |
| `record` | Validates what the step wrote against the frontmatter `step` handed out, then appends the step's event to `index.jsonl`. On failure it records nothing and prints which keys are wrong. A step that takes the working tree must still hold the lock. Recording a `decide` whose route is not `commit` also clears that lock's record of the lap just finished, which is what lets the cycle turn again. |
| `tracers` | That request's tracers, from its plan, with the phase they belong to, whether the plan declared them parallel, and their status from the implement record's ledger. `--next` prints just the group to implement next, comma-separated and ready for `step --tracer`; `--last` prints the group the implement record says was actually built, which is what `verify` checks and what a rework redoes. Read-only, and the only place plan markdown is parsed. |
| `stint` | Reports who holds the stint, how far through the current lap of the cycle they are, and which tracers are pending. `--release` hands the stint back — an administrative hatch for a human cleaning up outside a session, refused while the holder still has pending tracers unless `--force`, and never a statement that a run was good. Changes nothing else — no artifact, no status, no `index.jsonl` line. |
| `land` | The irreversible half of `commit`, run after `record`: stages everything, commits it to the request's branch with the message the commit record carries, appends a `landed` event, and releases the stint. **Local only** — nothing is pushed. Skipped when it has already happened, so an interrupted run is retried by running it again. |
| `publish` | Pushes the branch to origin and prints the title the commit record carries, for the pull request you open yourself. Refused until a recorded `review` says the human approved the work. This is the first moment anything about a request leaves the machine, and the only command that makes it public. |
| `train` | The stacked branches this workspace's requests own — each one's base, whether it has landed, and which is the tip a new request would be cut from. Read-only, and the only place branch metadata is read outside the libs. |
| `worktree` | Stands up, tears down, or locates the throwaway checkout a `review` is QA'd in — detached at that request's branch, under `db/<slug>/worktrees/<id>/`. `--create` is idempotent, so a review abandoned mid-way costs the next one nothing. |
| `signoff` | Writes the human's review decision to `db/<slug>/signoff/<id>.txt`, verbatim. The mirror of `new`, for the other end of the loop and for the same reason. Nothing is recorded in `index.jsonl`. |
| `close` | Ends a request whose work has landed on the default branch: prunes the loop's metadata from its branch so it leaves the train, deletes the local branch, and appends a `closed` event. `--abandon` drops the work instead. |
| `clear` | Deletes a request's artifacts and appends a `cleared` event. Requires `--id` or `--all`, prints what it's about to delete, and asks for confirmation unless `--yes` (mandatory in a non-interactive shell). `index.jsonl` is never rewritten; `memory.md` is never touched. Releases the lock if the cleared request held it. |
| `memory` | The workspace's accumulated knowledge at `db/<slug>/memory.md`, which every step is handed and none writes directly. `--show` prints it. `--merge` takes a sectioned delta on stdin: each `## Section` it names replaces that section's body, every section it does not name is kept untouched, and bash writes the title and provenance line itself. `--decision` appends one entry under `## Past Decisions & Rationale`. Reports the document's size, and which sections to prune when it is over budget. |
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
| **Human intentions/decisions** | `.txt` | Verbatim, unedited human input — the raw request text, and the review sign-off |
| **Automated operation log** | `.jsonl` | Append-only record of what the automation *did* — one line per lifecycle event |
| **Everything else** | `.md` | Substantive, agent-authored content meant to flow forward as context for the next step — or double as material for a skill/subagent/command later |

Concretely, per request: `db/<slug>/raw/<id>.txt` and
`db/<slug>/signoff/<id>.txt` (human), `db/<slug>/index.jsonl` (automation log),
and one `.md` per completed step — `db/<slug>/requests/<id>.md`,
`research/<id>.md`, `scope/<id>.md`, `plan/<id>.md`, `implement/<id>.md`,
`verify/<id>.md`, `decide/<id>.md`, `commit/<id>.md`, `review/<id>.md`.

The two `.txt` kinds bracket the loop, and both exist for the same reason: the
human's words reach disk before anything structures them, so a failed pass can
never lose what they said. `raw` precedes the `request` step; `signoff`
precedes the `review` step, which is why `review` is the one step whose human
input is captured *before* `loop/bin/step` is called rather than during it.

Three per-slug things are automation state rather than a fourth taxonomy kind:
`db/<slug>/running.json` (the overseer session's pid and start time) lets
concurrent terminals see that a workspace is being driven, and
`db/<slug>/implement.lock` (two lines: the request id that owns the working
tree, and which exclusive steps have recorded on the current lap of the cycle)
says who holds the stint and how far through a lap they are; and
`db/<slug>/worktrees/<id>/` is the throwaway checkout a `review` is QA'd in.
None is a record of anything that happened — that is what `index.jsonl` is for.

The worktree lives here rather than inside the project for the same reason
everything else does: a directory inside the workspace repo is one `git add -A`
away from being committed into it, and un-ignoring it would mean editing the
project's own `.gitignore`.

Three files are still "everything else" `.md` but do not flow forward to just
*the next* step, because the inner loop runs more than once:

- `db/<slug>/memory.md` flows forward to *every* future step and *every* future
  request for that slug. It's a living document, not a per-request artifact, so
  it has no frontmatter and `clear` never touches it.

  Because it is read that widely — once per subagent, on every step, of every
  lap, of every request — its size is a tax on the whole loop and its accuracy
  is a shortcut for the whole loop. A `## Commands` block naming the project's
  test command saves `verify` from going and finding one, every run, forever;
  a paragraph recording that a fact was re-confirmed on some date is paid for
  on every run and can be acted on by none of them. So no step writes it
  directly. `research` sends `loop/bin/memory --merge` a **delta** — only the
  sections that changed, each replacing its old body — and `decide` and `review`
  append to `## Past Decisions & Rationale` through `--decision`. Bash owns the
  title, the provenance line, the section order, and the size budget it reports
  when the document has outgrown being useful. Left to a full rewrite each pass,
  memory accretes: the same fact restated with a newer date, sections that only
  ever grow, and every step paying for the accretion.
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
   the research, check the work will actually change files (see below), grill
   the human with up to 20 questions (important design questions first,
   best-practice defaults for small doubts, a recommendation offered whenever
   options are presented), and write a decision record naming the files that
   will change. *(built)*
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
8. **commit** — commit the work: write the commit message and the
   pull-request body from the records and the real diff, then `loop/bin/land`
   commits it to the request's own branch and hands the working tree back.
   Local; nothing is pushed. *(built)*
9. **review** — final review, and the gate before anything becomes public: an
   automated security and performance audit of the whole request's diff, manual
   QA with the operator in a throwaway worktree at that branch, and their
   decision — which the step records but does not make. `loop/bin/publish`
   pushes and opens the pull request afterwards, and only on approval.
   *(built)*

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
human. `scope` is a real conversation, so the overseer runs it in its own
session; the human is already talking to that session, and no subagent can take
over the conversation. Every other step but `review` needs nobody, so each goes
to a subagent that reads its instruction file, does the work, and reports one
line back. That is what keeps the overseer's window on the state of the loop
instead of on the contents of the artifacts.

`decide` used to be the exception — the overseer ran it itself, on the argument
that routing is its own job and must not be delegated. That argument confused
*authority* with *context*. The overseer still acts on every route, without
asking; what it does not need is the reading behind one. `decide` opens the
verify and implement records, weighs them, and picks from a five-value set that
`record` validates and `list --json` hands straight back — so a route survives
the overseer being restarted mid-cycle without it ever having held the record.
Running it in-session cost roughly ten turns and several thousand tokens of
permanently resident context per lap, in the most expensive window in the
system, to learn one word the loop was about to be told anyway.

`review` is the one step that splits: the overseer runs it, because it ends in
the human's decision, but delegates the audit of the whole request's diff to a
subagent — bulk content that must never enter the overseer's window. It is
therefore the second `steps/*.md` the overseer reads, alongside `scope.md`.

**The stint.** `implement`, `verify`, `decide` and `commit` take the
project's working tree, so one request may be in there at a time — two of them
editing the same tree produces a conflict nobody can untangle afterwards. Bash
owns that rule rather than the overseer's good intentions: `loop/bin/step`
claims `db/<slug>/implement.lock` before handing over the context and refuses
when another request holds it; `loop/bin/record` refuses to record a step whose
claim has gone. The lock deliberately outlives the session, so a restarted
overseer finds the request still holding the tree.

A request holds it for the whole of its stay in the cycle, not for one lap:
`decide` turns the cycle without ever handing the tree back, because the
changes are still there and still that request's. `loop/bin/land` is what ends
the stint — not `record commit`. Recording a commit means the artifact was
written and validated; the repository has not moved, and letting another
request in at that point would cut its branch off a tree still holding
uncommitted work. `land` is local: it commits and releases, and nothing is
pushed until a review has approved it.

`review` is deliberately outside the stint. It reads a throwaway worktree at
the request's own branch, so a request under review never blocks the next one
from starting — which is the whole point of handing the tree back at `land`.

**One lap at a time.** `plan` → `implement` → `verify` → `decide` is a cycle,
so running `implement` twice before anything checked the first would stack two
unjudged changes in the same working tree. `loop/bin/step` refuses it, exit 3:
`loop/bin/record` notes each exclusive step it commits on the lock's second
line, and a claim that has already recorded a step cannot start it again — it
is told which step comes next instead. `decide` then clears that line, and the
same request may run `implement` → `verify` → `decide` again. The marker lives
on the *claim*, not on the request, so a run whose `record` failed — nothing
committed, so nothing marked — is still retryable, and releasing the stint
clears the slate.

The one thing that does not clear is a `decide` that routed to `commit`: the
stint is on its last step, and re-running `decide` would only re-judge work
already judged. The operator is never asked to adjudicate a lap either — the
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
(free text, an integer, or a value from a fixed set), any artifact it should be
handed *if it exists* without being blocked when it doesn't, and any key whose
value bash derives from the workspace's git repo rather than from `db/`. Paths,
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

### The loop delivers diffs

Every step after `scope` assumes there will be one: `implement` writes it,
`verify` runs it, `commit` describes it, `land` commits it. A request that
changes no file — an audit, a review, a recommendation, a question — has
nothing for any of them to do. It runs the whole cycle, reaches `land`, and
dead-ends there with nothing to commit, having spent a plan, an implement, a
verify and a decide on something an agent asked directly would have answered in
one pass.

So `scope` establishes, before it spends a single question on *how*, which
files under the workspace will be different when this is done. If the answer is
none, it says so and puts it to the human: take it out of the loop, reshape it
into the change it implies, or knowingly keep it as a record that commits
nothing. Taking it out means `scope` writes nothing at all and the overseer
clears the request — nothing past `research` was ever recorded, so there is no
other cleanup.

`land` is the backstop rather than the guard. When a request reaches it having
changed nothing, it names the audit case and points at `loop/bin/clear`, which
is what releases the working tree for the next request. That is a worse place
to find out, which is why the question is asked at `scope`.

### The train

Past `commit` several requests are alive at once — each on its own branch, each
with a pull request open. Nothing serializes them any more: `land` hands the
working tree back, so the next request starts while the last is still in
review. What keeps them from colliding is that **every request is cut off the
one in front of it**:

```
origin/main <- feature/add-a-login-form-aaaa1111
            <- hotfix/fix-the-logout-redirect-bbbb2222
            <- change/third-thing-cccc3333          (the tip)
```

A train of requests, a train of stacked branches. A request's changes were
written on top of everything before it, so that is the only base against which
its diff means anything.

**The branch is cut at stint entry, not at commit.** `loop/bin/step` resolves
the tip and checks out a new branch the moment a request takes the working
tree. Deciding the base later would mean either a checkout carrying changes
somewhere they were never built against, or a rebase nobody asked for. Cutting
first makes a request's diff exactly its own work, against exactly the tree it
was written on — and makes "start from the correct branch" a precondition bash
enforces rather than something the overseer is trusted to remember. It is also
why a dirty tree is refused at entry: whatever is in it belongs to somebody
else, and it would ride into this request's branch and its pull request.

**The chain lives in git, not in `db/`.** Three keys per branch, in the
workspace repo's own config:

```
branch.<branch>.looprequest   the request that owns it
branch.<branch>.loopbase      what it was cut from
```

That is the linked list, and it is the exception to "centralized `db/` instead
of writing into the workspace" — a deliberate one. The rule exists so the
tool's bookkeeping is never mistaken for project source or committed into
someone's app repo; `.git/config` is neither tracked nor committable, and
per-branch metadata is exactly where git itself keeps `branch.<b>.remote`. The
alternative — a table in `db/` — would be a cache of git state that goes stale
the moment a branch is deleted outside the loop.

The tip is the live branch no other live branch names as its base.
`loop/bin/train` computes it; nothing else, least of all the overseer, works it
out by running git.

**A request leaves the train when it lands, and only then.** `loop/bin/close`
fetches and asks whether the branch is contained in the default branch, then
prunes those three keys — after which it is invisible to `train` and nobody
bases on it again. Requests already stacked behind it keep their recorded base
even though it has gone: their history is written, and the base falls back to
the default branch, which is where the vanished commits now live.

Ancestry is the reliable test only for a real merge commit: a squash collapses
the commits into a new one and a rebase rewrites them, so the branch never
becomes an ancestor however genuinely merged it is. So `close` has a second
test — it merges the branch into the default ref *in memory*
(`git merge-tree --write-tree`) and treats a result identical to the default
ref's own tree as proof that every patch is already upstream. That is plain
git, so it answers for a self-hosted remote as readily as for a public forge,
and it needs no credentials.

### Nothing is public until a human says so

The work of a request moves in three separate, separately-refusable steps, and
only the third one is visible to anyone else:

| | What it does | Where it is |
|---|---|---|
| `land` | commits the work to the request's branch | this machine |
| `publish` | pushes the branch to origin | your git host |
| `close` | ends the request once its work has landed | this machine |

`publish` is refused until `db/<slug>/review/<id>.md` exists and its `outcome`
is `approved` or `followups`. A review that came back `rejected` publishes
nothing at all: its branch stays local, stays in the train, and the findings
become requests cut off it.

That split is why `review` reads a local branch rather than a pull request. A
review that runs *after* the work is pushed is a formality — the blunder is
already visible, and withdrawing it is its own small announcement. Running the
audit and the QA against a local branch makes the human's approval the thing
that publishes, rather than something that follows publication.

Opening the pull request itself is deliberately left to a human. The loop has
no opinion about which forge a remote lives on, and needs no credentials for
one beyond the ssh key that pushes.

The cost is that the `commit` step writes a pull-request title and body for a
pull request that may never be opened. That is the right trade: writing them is
free, and it is `review` that most wants them — a body describing what changed
and what to look at is exactly the briefing a reviewer needs.

### Plan decomposition (inside a `plan`)

A plan evaluates the scoped work and writes **one** `db/<slug>/plan/<id>.md`:

| Term | Meaning |
|---|---|
| **Horizontal layer** | Architectural stratum this request touches (named from the real codebase). |
| **Vertical layer** | Cross-cutting concern that forces sequencing — only when it matters. |
| **Phase** | Ordered batch that should be done/verified before the next depends on it. |
| **Vertical tracer** | Thin end-to-end slice through horizontals; independently implementable/verifiable (`p1.t1` ids). |

Layers = map; tracers = routes; phases = waves. Prefer few phases. Frontmatter
includes planner-owned `impact` (integer >= 1, lower = smaller blast radius)
and `phase_count`.

**`parallel` is the expensive field, in both directions.** `plan` does not act
on it; `implement` does, through `loop/bin/tracers --next`, which batches a
phase's parallel tracers into a single run. Declare it `true` for two tracers
that touch the same file and they collide inside one run. Declare it `false`
for tracers that touch nothing in common and the phase becomes N laps of
`implement` → `verify` → `decide` where one would have produced the same diff —
the quieter mistake, because every individual record still looks correct.

So the test is file ownership and nothing else: within a phase, disjoint means
parallel. A dependency that is only about the order things are easiest to check
in is what **phases** are for. `loop/bin/record` re-reads the plan it just
validated and says so on stderr when a phase serializes tracers whose owned
paths do not overlap — advice, never a refusal, because owned-path sets are
prose and a heuristic reading of prose must not be able to block a record.

## Providers

The tool must not hardcode a specific CLI. `bin/lib/providers.sh` loads a bundle
from the registry at `providers/<id>/` — the repo's top-level one, shared with
the app rather than the loop's own. A bundle is `manifest.json`, `provider.sh`,
and that provider's own config tree; the manifest's `loop` field says whether
the loop can run it (`"bundle"`) or the app carries it alone (`"none"`), and its
`app` field says the same in the other direction. See
[architecture-design.md §1.1.2](../docs/architecture-design.md) for the whole
shape. The session contract is two functions, because a provider's whole job is
to open one session:

```
provider_check_available
provider_session <prompt> <workspace_dir>
```

**Invariant:** when a provider is active, the only config the session sees is
that bundle's own — never `loop/` root, never the repo's own, never another
provider's tree. How that is enforced is the bundle's business, because it
depends on what its CLI offers: `claude-code` is handed its settings file by
name with discovery switched off entirely, while `cursor` has no config-path
flag, so its bundle keeps the process's working directory on itself.

**The session's workspace is the project**, `workspace/<name>/` — the directory
the operator named and the one `implement` edits. Only the weaker of the two
CLIs ties config to that same directory, and it is the one whose cwd therefore
stays on the bundle; neither opens the operator onto a config folder.

Real providers today: `claude-code` (`providers/claude-code/`, CLI `claude`) and
`cursor` (`providers/cursor/`, CLI `agent`). Which one the *loop* runs stays its
own choice, in `loop/.provider`: Overseer's "currently attached provider" is
about the app's own sessions, and the two are deliberately not the same setting
even though the registry and the sign-in behind them now are.

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
  `implement` and `verify` so their artifacts never enter its window. Cursor's
  CLI can spawn subagents (`.cursor/agents/*.md`, close to claude's own
  `.claude/agents/*.md` format) — but which of its models actually delegate is
  not yet confirmed in this repo, so it is treated as unverified rather than
  assumed working. `providers/<id>/manifest.json`'s `loopSubagents` field
  states that per provider (`"unverified"` for `cursor` today), and the
  overseer checks it (`subagents_available` in the step context) before
  attempting to delegate at all — false, it runs the step itself, correct but
  paying the context, the same fallback as a CLI with no subagent mechanism.
  Confirming a model that does delegate and flipping the field is a one-line
  change, not a new mechanism.
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
