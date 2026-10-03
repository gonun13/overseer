# Dev loop — Behavioural Spec

The dev loop's settled vocabulary — request, step, stint, phase, tracer, train, trunk, route,
outcome, status — is [`loop/CONTEXT.md`](../../loop/CONTEXT.md), which loop sessions read at
runtime; [domain.md](../domain.md) points there rather than repeating it. This file is the
spec-level description of how the loop behaves; usage lives in
[`loop/README.md`](../../loop/README.md), and the instructions an agent follows at runtime live in
`loop/overseer.md` and `loop/steps/*.md`.

A command-line tool, at `loop/` in this repo, that runs development loops —
feature requests, fixes, changes — against a project under `/workspace/<name>/`.
It is **not** a `packages/*` workspace: it uses only bash scripts, a provider
CLI, and plain files, and is versioned/released independently of the lockstep
package table ([architecture.md §8.1](../architecture.md#81-monorepo-rule)). It is incubating —
see the "Dev loop in a console" row of [architecture.md §3](../architecture.md#3-feature-map) —
with the intent to fold into the main app, at which point it would gain a real `packages/` entry
and join the lockstep-versioned set.

**It runs in the app's container, not on the host.** The `implement` step edits
a project in place and runs that project's own test command, on a session
granted `Write`, `Edit` and an unprefixed `Bash` — the widest grant anywhere in
this repo, and a subagent inherits all of it. That belongs behind the same
boundary as everything else here ([architecture.md §6](../architecture.md#6-security)), so `./bin/loop <workspace>` opens the
session inside the running stack and `loop/run` refuses to start one on the
host, keyed on `OVERSEER_IN_CONTAINER` exactly as `bin/_in-container.sh` guards
the app's own npm scripts. The `loop/bin/*` commands are deliberately not
guarded: they read and record state and open no session.

Sharing the container is not only about the sandbox. The app and the loop are
two front-ends onto the same three things — a workspace, a provider CLI, and a
project's toolchain — and they used to disagree about all three. Now they do
not: one `/workspace` (both read `OVERSEER_WORKSPACE`), one provider registry
([architecture.md §1.1.2](../architecture.md#112-the-provider-registry)), one `agent-home` volume holding every CLI's auth, and one Docker
daemon for project builds ([data.md §1](../data.md#1-where-things-live), [architecture.md §6.3](../architecture.md#63-the-daemon-that-builds-workspace-projects)).

**The overseer.** `loop/run <workspace>` opens one interactive session on the
configured provider agent and hands it the terminal. That session is the
orchestrator: it reads the workspace's state, resumes what is mid-flight, plans
what is scoped, or asks the human for a new request, and keeps going until the
human stops it. Its instructions are [`loop/overseer.md`](../../loop/overseer.md).
Bash owns no control flow — the tool deliberately does not reimplement, as a
shell state machine, the orchestration the agent is better at.

**The bash surface.** What bash does own is everything a language model should
not improvise: allocating request ids and paths, stamping timestamps,
validating what a step wrote, appending to the log, and serializing access to
the project's working tree. That is sixteen commands — `list`, `new`, `step`, `record`, `tracers`,
`stint`, `memory`, `land`, `publish`, `train`, `worktree`, `signoff`, `close`,
`clear`, `provider`, `models` (plus the lints `check` and `check-providers`) — each taking a workspace name, printing JSON to
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
block (the same tolerant, line-based convention the CLIs use for
`.claude/agents/*.md` name/description) carries the handful of fields that need
to stay structured. One exception: `memory.md` is also `.md` but has no
frontmatter and isn't per-request — it's a living document per workspace, read
and rewritten on every `research` run, flowing forward to every future
step/request for that workspace rather than just the next one.

**Provider abstraction.** `loop/bin/lib/providers.sh` loads a bundle from the
shared registry at `providers/<id>/` ([architecture.md §1.1.2](../architecture.md#112-the-provider-registry)) — `manifest.json` plus
`provider.sh` plus that provider's config tree. The contract is two functions,
`provider_check_available` and `provider_session <prompt> <workspace_dir>`,
because a provider's whole job is to open one session. **Invariant:** the only
config a session sees is its own bundle's — never `loop/` root, never another
provider. Each bundle enforces that with whatever its CLI gives it, and the two
differ: `claude` takes `--settings <file>` with `--setting-sources ""`, so
no discovery runs at all, while `cursor` has no config-path flag and pins the
process's working directory to the bundle instead. Stating the mechanism per
bundle rather than as one sentence matters, because the weaker form is only as
good as the CLI's preference for the nearest config — and the repo root is
itself a git root carrying `.claude/`. **The session's workspace is always the
project**, never the bundle: the operator asked for a project, and `implement`
edits one. Both `claude` (CLI `claude`) and
`cursor` (CLI `agent`) are real implementations; which one runs is the loop's
own choice, in `loop/.provider`, and stays separate from the app's
`attached_provider` ([architecture.md §2](../architecture.md#2-auth--config)). `loop/bin/check-providers` lints that a provider's
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
tracers** (see [`loop/README.md`](../../loop/README.md)); the plan file also
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

**The stint.** `implement`, `verify`, `decide` and `commit` take the
project's working tree, so exactly one request may hold the stint per
workspace — two of them editing the same tree is an unrecoverable conflict.
Bash enforces it rather than the overseer: `loop/bin/step` claims
`db/<slug>/implement.lock` (two lines: the holding request's id, and what that
claim has recorded) before handing over a context and refuses when another
request holds it, and `loop/bin/record` refuses a step whose claim has lapsed.
Unlike the session lease it outlives the session on purpose, so a restarted
overseer finds the tree still owned. A request holds it for its whole stay in
the cycle, not for one lap: `decide` turns the cycle without handing the tree
back, because the changes are still there and still that request's.

`loop/bin/land` ends the stint — not `record commit`. Recording a commit means
the artifact was written and validated; the repository has not moved, and
letting another request in there would cut its branch off a tree still holding
uncommitted work. `review` is outside the stint entirely: it reads a throwaway
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
`loop/bin/stint --release` and `loop/bin/clear` are administrative cleanup
outside a session; neither marks anything verified.

**Nothing is public until a human approves it.** A request's work moves in
three separately-refusable stages: `land` commits it to a local branch,
`publish` pushes that branch to origin, `close` ends the request once its work
has landed on the default branch. Only `publish` is visible to anyone else, and
it is refused until a recorded `review` says the human approved the work — a
`rejected` review publishes nothing at all.

Opening the pull request is deliberately a human's job. The loop has no opinion
about which forge a remote lives on, and needs no credential for one beyond the
ssh key that pushes ([architecture.md §2.2](../architecture.md#22-git-access)) — which is also what keeps this working for a
self-hosted remote rather than one vendor's API.

That ordering is why `review` reads a local branch rather than a pushed one. A
review that runs after the work is public is a formality: the mistake is
already out, and withdrawing it is its own announcement. Auditing a local
branch makes the human's approval the act that publishes. The cost is that the
`commit` step writes a pull-request title and body that may never be used —
cheap, and it is `review` that most wants them, since a body describing what
changed and what to look at is exactly a reviewer's briefing.

**The train, and where branch metadata lives.** Past `commit` several requests
are alive at once, each on its own branch. They do not
collide because every request's branch is cut off the one in front of it — a
train of stacked branches ending at the default branch. `loop/bin/step` cuts it
at *stint entry* rather than at commit, so a request's diff is exactly its own
work against exactly the tree it was written on, and a dirty tree is refused
there because whatever is in it belongs to somebody else.

That chain is stored in the workspace repo's own `.git/config` —
`branch.<b>.looprequest` and `.loopbase` — which is **the one place the
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
the stint, skipping the commit if it already happened so an interrupted run is
retried by rerunning it. It appends a `landed` event of its own, which is what
distinguishes "the record was written" from "the work is committed" after a
crash between the two. `land` is **local**: nothing is pushed. `review` audits
the whole request's diff for security and performance in a delegated subagent,
walks the operator through manual QA in a throwaway `git worktree` at that
request's branch, and records the outcome they chose — captured first,
verbatim, by `loop/bin/signoff` into the second of the two `.txt` kinds.
`loop/bin/publish` pushes the branch to origin, and is refused
unless that review recorded `approved` or `followups`. `loop/bin/close` then
ends the request once its work has landed on the default branch — judged by
ancestry, and failing that by an in-memory merge (`git merge-tree
--write-tree`) that produces no change, which is what makes a squash or rebase
merge count. A per-slug `running.json` lease surfaces an active overseer
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
