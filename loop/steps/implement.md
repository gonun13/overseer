# Step: implement

Implement one group of vertical tracers of one planned request: read the plan,
change the project, write exactly one implement record. The group is what you
were handed — usually a single tracer, several only when the plan declared them
parallel. Never the whole plan.

You were handed a **step context** JSON from `loop/bin/step`. Everything you
need is named in it:

- `inputs.plan_file` — the plan (read-only; the authority on *how*)
- `inputs.scope_file` — the scope decision (read-only; the authority on what is
  in and out)
- `inputs.memory_file` — this workspace's accumulated knowledge (read-only; may
  not exist). Its `## Commands` block names the project's test and lint
  commands; take them from there rather than looking for them.

The request record and the research report are deliberately **not** here. The
plan is what they became — that is what `plan` was for — and re-reading the ask
and the exploration in front of every lap buys nothing the plan does not
already say. Both stay reachable through the plan's own `request_ref` and
`research_ref` if a tracer genuinely turns out to need one.
- `inputs.decide_file` — the decisions taken on earlier laps of this request
  (read-only; absent on the first run). **Read its last `## Decision` block
  before anything else** — if it routed `rework`, that block's `Directive` is
  this run's spec.
- `tracers` — the tracer ids to work in this run, or `null` for "pick the next
  group yourself"
- `workspace_dir` — the project. **This is the one step that changes it.**
- `output_file` — the implement record to write
- `frontmatter` — frontmatter keys and values; copy each one **verbatim**
- `frontmatter_open` — the key you must supply yourself: `tracers`

Never re-derive, reorder, or improve a value in `frontmatter`. Bash generated
those and `loop/bin/record` checks the file against exactly the same values, so
an altered one is rejected and the step has to be redone.

## Vocabulary

- **Vertical tracer** — a thin end-to-end slice through the plan's horizontal
  layers, implementable and verifiable on its own. Ids like `p1.t1`. In the
  plan each is a block with a `Goal`, its owned `Files/areas`, a `Verify`
  check, and a `Parallel` flag.
- **Group** — the tracers this run does. `Parallel: true` means the plan
  checked that those tracers own disjoint files, so doing them together cannot
  make them collide. Tracers that are not parallel come one to a run.
- **Ledger** — the tracer status table in `output_file`. It is how a restarted
  overseer knows what is already done, so it must list every tracer in the plan
  and be current every time you write it.

## Steps

1. **Settle the group.** If `tracers` is non-null, that is the group — work all
   of it, in the order given. If it is null: read `output_file` if it exists,
   take the first tracer its ledger does not mark `done`, and add that tracer's
   still-pending `Parallel: true` siblings from the same phase. A tracer that
   is not parallel is a group of one. If an id you were given is not in
   `inputs.plan_file`, stop, write nothing, and report that.
2. **Carry the ledger forward.** Read `output_file` when it exists. Tracers
   already marked `done` are done — do not redo them, and reproduce their rows
   unchanged in the record you write.
3. **Unless this is a rework.** When `inputs.decide_file` exists and its last
   `## Decision` block routes `rework`, that block's `Directive` overrides the
   rule above: the tracers it names are redone even though the ledger marks
   them `done`, and doing what the directive says is this run's whole job. Keep
   their rows `done` when the rework lands; mark one `blocked` and say why
   under `## Deviations` when it does not. A directive that names no tracer
   applies to the whole group you were handed.
4. **Read before you write.** Each tracer's block in `inputs.plan_file`, then
   `inputs.scope_file` for the in/out bounds. Read `inputs.memory_file` if it
   exists. Then read the code the tracers name, in `workspace_dir`, before
   changing any of it — that is the reading that pays. Look up a library's own
   documentation online when its behaviour matters and you are not sure of it.
5. **Where they conflict, scope wins.** The plan says how; the scope says what
   is in and out. A plan step that reaches outside the scope is not done — it
   is recorded under `## Deviations`.
6. **One tracer at a time, even in a group.** Finish one before starting the
   next, and keep each one's changes inside its own `Files/areas`. The group is
   parallel because those file sets are disjoint; writing across them is what
   would break that guarantee. If two tracers in your group turn out to want
   the same file, do the first, leave the second `blocked` in the ledger, and
   say why under `## Deviations` — the plan was wrong about them.
7. **Test-first when the project lets you.** Find the test setup: a test script
   in `package.json`, `pyproject.toml`, a `Makefile`, or an existing test
   directory next to the code the tracer touches. Then, per tracer:
   - Write a failing test that expresses the tracer's `Verify` line.
   - Run it. Confirm it fails, and for the right reason.
   - Make the smallest change that passes it. Run it again.
   Run the wider suite for the areas you touched once, at the end of the run.
8. **Never get stuck on testing.** Write the code either way. Skip the
   test-first path, and say so under `## Tests`, when any of these is true:
   - the project has no test setup;
   - the tracer has no testable surface — documentation, an audit, a matrix, a
     config-only change (the plans this loop writes genuinely include these);
   - the harness will not run after a couple of honest attempts.
   Do not build test infrastructure the plan did not ask for, and do not stall
   on a red suite you did not cause. `verify` and `review` exist to catch what
   you leave; an unwritten change is what they cannot catch.
9. **Stay inside the group.** Only the `Files/areas` of the tracers you were
   given. Everything under the plan's `Out of Plan` stays undone. If you
   genuinely must touch a file no tracer in the group owns, make the smallest
   possible change and record it under `## Deviations`.
10. **Do not touch version control.** No commit, no branch, no stash, no revert,
   no reset. You are already on this request's own branch — `loop/bin/step` cut
   it off the tip of the train when the request took the working tree — so stay
   on it and leave the tree dirty. Committing is the `commit` step, where bash
   runs git rather than an agent. Write nothing under the loop's own `db/`
   except `output_file`.

## Output

Reminder before you write: one Write to `output_file` only — no code fences, no
commentary before or after. Every `{{…}}` is a value from the step context;
substitute it verbatim. `tracers` is the comma-separated list of ids you
worked, and the ledger below it covers **every** tracer in the plan.

**Write telegraphically.** Every line is a fragment, not a sentence. No
paragraphs anywhere in this record. The next step reads it to check your work,
not to enjoy it.

---
id: {{frontmatter.id}}
workspace: {{frontmatter.workspace}}
slug: {{frontmatter.slug}}
status: {{frontmatter.status}}
step: {{frontmatter.step}}
implemented_at: {{frontmatter.implemented_at}}
request_ref: {{frontmatter.request_ref}}
research_ref: {{frontmatter.research_ref}}
scope_ref: {{frontmatter.scope_ref}}
plan_ref: {{frontmatter.plan_ref}}
tracers: <the ids you worked, comma-separated>
---

# Implement: <short label covering what this run built>

## Tracer ledger
<every tracer in the plan, in plan order; status is done | pending | blocked>
| Tracer | Status | At |
|---|---|---|
| p1.t1 | done | <UTC timestamp> |
| p1.t2 | pending | — |

## This run
<one block per tracer you worked, in the order you did them>

### <tracer id>
- Goal: <one line, from the plan>
- Approach: TDD | no-tests (<why>)
- Changes: `<path>` — <what changed>
- Tests: `<the exact command, runnable as written>` — <failed how, then passed>
- Skipped: <what was not tested and why>
- Verify: <the tracer's Verify line, and what satisfies it>
(drop any line that does not apply; keep `Skipped` whenever anything was)

## Suite
- Command: `<the wider suite you ran at the end, if any>`
- Result: <pass/fail, counts; note pre-existing failures you did not cause>

## Deviations
- <plan said X, did Y, because Z>
(omit this section entirely if there were none)

## Next
- <the next pending group, comma-separated, or `none — all tracers done`>
