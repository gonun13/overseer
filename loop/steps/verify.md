# Step: verify

Check one group of vertical tracers that `implement` just built: run the
project's own tests, run its own lints, drive the change the way a user would,
and write down what happened. Exactly one verify record.

**You do not judge, and you do not stop.** A failing check is the most valuable
thing you can find — it is data for the next step, not a reason to abandon this
one. Run every check even after one fails. Fix nothing.

You were handed a **step context** JSON from `loop/bin/step`. Everything you
need is named in it:

- `inputs.implement_file` — what the last run built: its tracer ledger, the
  test command it used, what it skipped, what it deviated on (read-only)
- `inputs.plan_file` — the plan; each tracer's `Verify` line is what you are
  checking against (read-only)
- `inputs.scope_file` — the scope decision; read it only when a `Verify` line
  points at an acceptance item you need the wording of (read-only)
- `inputs.memory_file` — this workspace's accumulated knowledge (read-only; may
  not exist). It often already names the project's test and lint commands.
- `tracers` — the tracer ids this run checks. Never re-derive them.
- `workspace_dir` — the project. You run its commands; you do not edit it.
- `output_file` — the verify record to write
- `frontmatter` — frontmatter keys and values; copy each one **verbatim**
- `frontmatter_open` — the keys you must supply yourself: `verdict`,
  `checks_run`

Never re-derive, reorder, or improve a value in `frontmatter`. Bash generated
those and `loop/bin/record` checks the file against exactly the same values, so
an altered one is rejected and the step has to be redone.

## Standing rules

1. **Run every check.** Tests, lints, simulation, carry-forward — all four,
   every run, in that order. A red result is recorded and the next check still
   runs. Nothing here exits early.
2. **Change nothing.** No source edits, no fixes, no dependency additions, no
   version control — not a commit, not a stash, not a revert. Build output,
   caches and installed dependencies that a test command creates on its own are
   fine; a tracked source file is not. If a check needs a scratch file, put it
   outside `workspace_dir` and say so.
3. **Do not judge.** `verdict` is mechanical, not an opinion:
   - any check failed → `fail`
   - nothing could be run at all → `blocked`
   - otherwise → `pass`
   Skips are not failures. A failure the implement record already flagged as
   pre-existing is not this run's failure — note it and move on.
4. **Report commands, not logs.** Every check names the exact command, runnable
   as written. Failure output is trimmed to the lines that show the failure, at
   most about twenty per failure. Never paste a whole log into the record.

## The checks

**1. Tests.** Find the command: `inputs.memory_file` and the implement record's
`## Suite` line usually name it; otherwise look for a test script in
`package.json`, a `Makefile` target, `pyproject.toml`, or a test directory next
to the code the tracers touched. Run the targeted tests for the group's files
first, then the wider suite once. Record both. If the project has no test
setup, that is a skip with a reason — not a failure, and not something you go
and build.

**2. Lints.** Only what the project already defines: its lint, typecheck, and
format-check commands. Run each one. Never add tooling the project lacks, and
never reconfigure the tooling it has to make a run go green.

**3. Simulation.** Drive the surface each tracer touched, the way someone using
it would: run the command-line path end to end, call the endpoint, exercise the
module from a scratch script, drive the interface where you have a browser tool
for it. Then compare what actually happened against that tracer's `Verify` line
from the plan, and write down both — what you did, and what you saw. Prefer the
real surface over a re-run of the tests: the tests are check 1, and simulation
exists to catch what they do not. When the surface genuinely cannot be driven —
no entry point, needs credentials you do not have, needs a device — say which
and why. That is a skip, with a reason, not a failure.

**4. Carry-forward.** The implement record lists what it deviated on
(`## Deviations`) and what it left untested (`Skipped`). Take each one and say
whether it is still open or now resolved. This is the only reason those lines
were written down.

## Output

Reminder before you write: one Write to `output_file` only — no code fences, no
commentary before or after. Every `{{…}}` is a value from the step context;
substitute it verbatim. `verdict` is mechanical (any failure → `fail`; nothing
runnable at all → `blocked`; otherwise `pass`); `checks_run` is the
comma-separated list of the checks that actually ran.

**Write telegraphically.** Every line is a fragment, not a sentence. No
paragraphs anywhere in this record. The next step reads it to route the request,
not to enjoy it. Trim failure output to the failing lines.

---
id: {{frontmatter.id}}
workspace: {{frontmatter.workspace}}
slug: {{frontmatter.slug}}
status: {{frontmatter.status}}
step: {{frontmatter.step}}
verified_at: {{frontmatter.verified_at}}
scope_ref: {{frontmatter.scope_ref}}
plan_ref: {{frontmatter.plan_ref}}
implement_ref: {{frontmatter.implement_ref}}
verdict: <pass | fail | blocked>
checks_run: <of tests, lints, simulation, carry-forward: the ones that ran>
---

# Verify: <short label covering what this run checked>

## Verdict
- <pass | fail | blocked> — <one line, why>
- Tracers checked: <the ids from `tracers`>

## Checks
| Check | Command | Result |
|---|---|---|
| tests (targeted) | `<exact command>` | <pass/fail, counts> |
| tests (suite) | `<exact command>` | <pass/fail, counts> |
| lint | `<exact command>` | <pass/fail> |
| typecheck | `<exact command>` | <pass/fail, or skipped — none configured> |
| simulation | <what you drove> | <pass/fail, or skipped — why> |

## Failures
### <check> — <tracer id, if it is attributable to one>
- Command: `<exact command>`
- Output: <the failing lines only, trimmed>
- Attributable: <this run | pre-existing, per the implement record>
(omit this section entirely if there were none)

## Simulation
- Attempted: <yes | no — why not>
- How: <what you drove, and with what>
- Observed: <what actually happened>
- Against: <the tracer's Verify line, and whether it is satisfied>

## Not checked
- <tracer or surface> — <what could not be checked, and why>
(omit if everything was checked)

## Carried from implement
- Deviations: <each one — still open | resolved>
- Skipped tests: <each one — still open | now covered>
(write `none` for either if the implement record listed none)
