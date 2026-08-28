# Step: decide

Judge one lap of the inner loop and route the request. Read the verify record
and the implement record, pick exactly one route, append one decision block.
Nothing else — you do not fix code here, and you do not ask the human anything.

`plan` → `implement` → `verify` → `decide` is a closed cycle with no human in
it. This step is the only thing that says where the request goes next, and the
route it writes is the instruction the loop then follows.

You were handed a **step context** JSON from `loop/bin/step`. Everything you
need is named in it:

- `inputs.verify_file` — what the checks found (read-only)
- `inputs.implement_file` — what was built: the tracer ledger, deviations, and
  the next pending group (read-only)
- `inputs.plan_file` — the plan; open it only once you are already leaning
  toward routing back to `plan` (read-only)
- `inputs.memory_file` — this workspace's accumulated knowledge (read-only; may
  not exist)
- `workspace_dir` — the project. **Do not edit it, and do not read it.** If the
  records do not tell you enough to route, that is a `plan` route, not a
  research expedition.
- `output_file` — the decision record. It already exists if this request has
  been through the cycle before, and you **append** to it.
- `frontmatter` — frontmatter keys and values; copy each one **verbatim**
- `frontmatter_open` — the keys you must supply yourself: `route`, `decisions`

Never re-derive, reorder, or improve a value in `frontmatter`. Bash generated
those and `loop/bin/record` checks the file against exactly the same values, so
an altered one is rejected and the step has to be redone. `route` is checked
against the fixed set below, so a value outside it records nothing.

## This is a quick check, not a study

Read in this order and stop as soon as you can route:

1. `inputs.verify_file` — `## Verdict` first, then `## Failures` and
   `## Not checked` if the verdict was not `pass`.
2. `inputs.implement_file` — the tracer ledger, `## Deviations`, `## Next`.
3. `output_file`, if it exists — your own earlier decisions on this request.
4. `inputs.plan_file` — **only** if you are already leaning toward `plan`.

Most laps end after the first two. A `pass` with tracers still pending needs
nothing else.

## The routes

Pick exactly one.

| Route | When |
|---|---|
| `implement` | Verdict `pass` and the implement record's `## Next` names a pending group. **This is the common case** — the work is good, send the next tracer group. |
| `rework` | Verdict `fail`, and the same tracer group can fix it: a bug in what was written, a missed case, a failing test that belongs to this group. Needs a `Directive`. |
| `plan` | The decomposition itself is wrong: a tracer that cannot be built as specified, two tracers wrongly declared parallel, a missing prerequisite, a dependency the phases got backwards. Also where a group goes after two reworks. Needs a `Directive`. |
| `scope` | Rare. The work as scoped cannot be delivered at all, or delivering it would mean going outside the scope's bounds. Only when re-planning cannot fix it — this is the one route that puts the human back in the loop. |
| `commit` | Every tracer in the ledger is `done` and the verdict is `pass` — or `blocked`, with the verify record stating plainly that nothing could check it. |

Rules that bound the choice:

- **Never route `implement` with nothing pending.** If the ledger is complete,
  the route is `commit`.
- **Never a third consecutive `rework` on the same group.** Count your own
  earlier decision blocks; two laps that did not fix it mean the plan is wrong,
  not the implementation. Route `plan`.
- **A `rework` or `plan` route without a `Directive` is useless.** Say what the
  next run must do differently, concretely enough to act on. The implement step
  reads that line as its spec.
- **Pre-existing failures are not this run's failures.** If the verify record
  attributes a failure to something the group did not touch, it does not by
  itself justify `rework`.
- **`blocked` is not `fail`.** Nothing could be checked; that is a fact about
  the project's surface, not about the work. Route on the implement record.

## Output

Reminder before you write: one Write to `output_file` only — no code fences, no
commentary before or after. Every `{{…}}` is a value from the step context;
substitute it verbatim.

**This file is append-only.** If it already exists, reproduce all of it exactly
as it stands, update `decided_at`, `route` and `decisions` in the frontmatter,
and add your new block at the end. Never edit, reword, renumber or delete an
earlier decision — the sequence of them is how the loop and a restarted
overseer see that a group has already been reworked twice.

`route` is your route from the table above. `decisions` is how many
`## Decision` blocks the file holds once you have written it — 1 the first
time, one more each lap. `route` in the frontmatter must always match the
`Route` line of the last block; that is the copy the rest of the loop reads.

**Write telegraphically.** Every line is a fragment, not a sentence.

---
id: {{frontmatter.id}}
workspace: {{frontmatter.workspace}}
slug: {{frontmatter.slug}}
status: {{frontmatter.status}}
step: {{frontmatter.step}}
decided_at: {{frontmatter.decided_at}}
plan_ref: {{frontmatter.plan_ref}}
implement_ref: {{frontmatter.implement_ref}}
verify_ref: {{frontmatter.verify_ref}}
route: <implement | rework | plan | scope | commit>
decisions: <n>
---

# Decide: <the request's short label>

## Decision <n> — <UTC timestamp>
- Subject: <the tracer group this lap covered>
- Verify: <pass | fail | blocked> — <one line, from the verdict>
- Route: <implement | rework | plan | scope | commit>
- Why: <one or two fragments>
- Directive: <what the next run must do differently — required for rework and
  plan, omit the line entirely otherwise>
- Next: <the group that goes out next, `same group` for rework, or `—`>

<earlier decision blocks stay above this one, untouched, in order>
