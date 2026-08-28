# Step: review

Run the final review of one request whose work is committed to its own local
branch. An automated audit for security and performance, then manual QA with
the human at this terminal, then their decision — recorded, not made by you.
Exactly one review record.

**Nothing about this request is public yet, and this step does not make it so.**
The branch has not been pushed and there is no pull request. `loop/bin/publish`
opens one *after* this record says the human approved the work — which is what
makes this review the gate rather than a formality after the fact. A rejected
review pushes nothing at all.

**You run this step yourself, in this session**, like `scope` — it ends in a
conversation and a human's decision, and no subagent can take that over. The
one part you delegate is the audit, because reading a whole request's diff is
exactly the kind of bulk content that must never enter your window.

This is the last step. Nothing routes out of it back into the cycle: findings
become new requests, they are not repaired here.

You were handed a **step context** JSON from `loop/bin/step`. Everything you
need is named in it:

- `inputs.request_file` — what was asked for (read-only)
- `inputs.scope_file` — what was agreed this iteration would do. Read it
  directly: "did this stay inside its bounds" is the question of this step, and
  the scope record is the authority on the bounds (read-only)
- `inputs.commit_file` — the commit message, the branch, the base, and the
  pull-request body that will be used *if* this review approves the work
  (read-only)
- `inputs.signoff_file` — the human's decision, in their own words. It is
  already on disk before this step starts; see below (read-only)
- `inputs.memory_file` — this workspace's accumulated knowledge (read-only; may
  not exist)
- `workspace_dir` — the project. **Do not edit it and do not run it here** —
  the next request may already own that tree.
- `output_file` — the review record to write
- `frontmatter` — frontmatter keys and values; copy each one **verbatim**,
  including `branch` and `base_branch`
- `frontmatter_open` — the keys you must supply yourself: `outcome`, `findings`

Never re-derive, reorder, or improve a value in `frontmatter`. Bash generated
those and `loop/bin/record` checks the file against exactly the same values, so
an altered one is rejected and the step has to be redone.

## The sign-off comes before the step, not after

`inputs.signoff_file` is a **required input**, so `loop/bin/step` refuses to
hand out this context until it exists. That inverts the order every other step
runs in, and it is deliberate: it is the same shape as `loop/bin/new` preceding
the `request` step. The human's words go to disk verbatim, before anything
structures them, so a failed pass can never lose what they said.

In practice you do the audit and the QA **first**, then capture their decision,
then ask for this context:

```sh
"$LOOP_DIR"/bin/signoff <ws> <id> <<'LOOP_SIGNOFF_EOF'
<the human's decision, exactly as they gave it>
LOOP_SIGNOFF_EOF
"$LOOP_DIR"/bin/step <ws> <id> review
```

## Standing rules

1. **Change nothing, anywhere.** Not the project, not the worktree, not a
   dependency, not a config. The worktree is a read-only copy; a fix made in it
   goes nowhere and confuses the next person who looks.
2. **Do not run a git command that writes**, in either tree, and **do not use
   `gh` at all**. Do not push. Pushing and opening the pull request are
   `loop/bin/publish`'s job, and it runs after this record exists and only if
   it says the work was approved — that ordering is the whole point.
3. **Do not decide the outcome.** `outcome` transcribes what the human said in
   `inputs.signoff_file`. A high-severity finding on an `approved` sign-off is
   recorded as a finding and the outcome stays `approved` — your audit informs
   them, it does not overrule them.
4. **Do not re-run the project's tests.** `verify` did that, on every lap. This
   step exists to catch what a test suite cannot.
5. **Never fix a finding.** Every finding worth acting on becomes its own
   request, approved by the human, and goes through the loop like anything
   else. That is the whole mechanism.

## Step 1 — Stand up the QA checkout

```sh
"$LOOP_DIR"/bin/worktree <ws> <id> --create
```

That prints a path: a throwaway checkout, detached at this request's branch.
Use it, not `workspace_dir`. By now the next request may already be building on
top of this one in the main tree, and a reviewer looking at that tree would be
looking at two changes at once, unable to tell which broke what.

`loop/bin/record <ws> <id> review` takes it down again. You do not remove it by
hand.

## Step 2 — The audit, delegated

Spawn **one** subagent with a prompt of exactly this shape:

> Audit the diff `git -C <the worktree path> diff <base_branch>...<branch>` for
> **security** and **performance** defects only. Security: injection, secrets
> or credentials in the diff, authorization gaps, unsafe deserialization,
> unvalidated input crossing a trust boundary, a risky new dependency.
> Performance: N+1 queries, unbounded growth, synchronous work on a hot path,
> a materially heavier bundle or start-up.
> Ignore style, naming, formatting and test coverage — other steps own those.
> Report at most 10 findings, one table row each: severity (high/medium/low),
> `file:line`, and one line naming the concrete failure. Report the count and
> nothing else if there are none.
> **Do not report the diff's contents**, and change nothing.

Take back the table and the count. Nothing else enters your window.

If you have no way to spawn a subagent, do the audit yourself against the same
brief — it costs you the context the subagent would have absorbed.

## Step 3 — Manual QA, with the human

Give the operator a **numbered checklist** — one line each, at most about
seven — of things to actually try. Build it from the scope's acceptance
criteria first, then the audit's risk areas. Name the worktree path so they
know where to run it.

Then take what they observed, one item at a time or all at once, however they
want to give it. Every choice you put to them is a pick from a list, with your
recommendation first and a way out, exactly as everywhere else.

## Step 4 — The decision, and the follow-ups

Put the outcome to them as a choice:

| `outcome` | What it means |
|---|---|
| `approved` | push it and open the pull request, as it stands |
| `followups` | the same, and open the findings as new requests |
| `rejected` | publish nothing. The branch stays local and stays in the train, and the findings are opened as requests cut off it. |

Say plainly which one they are choosing: `approved` and `followups` are what
put this work on GitHub, `rejected` keeps it on this machine.

Then, for every audit finding and every QA problem worth its own request,
propose it and let them approve or drop each one. For each approved one:

```sh
"$LOOP_DIR"/bin/new <ws> <<'LOOP_RAW_EOF'
Follow-up from the review of "<the request's title>" (branch <branch>):
<the finding, in full, verbatim from the audit>
LOOP_RAW_EOF
```

They are ordinary requests and go through the loop like any other. Do not carry
anything else across — no parent id, no priority, no special casing.

Capture their decision with `loop/bin/signoff` as above, **then** ask for this
step's context, **then** write the record.

## When a review is worth remembering

A `rejected` outcome, and a follow-up the human approved, both say something
about this project that the code does not: a standard it is held to, a
constraint nobody wrote down, a shape of change that turns out not to be
wanted. Append one line for each, after recording:

```sh
loop/bin/memory {{frontmatter.workspace}} --decision <<'LOOP_MEMORY_EOF'
<one line: what the review objected to, and what to do instead next time>
LOOP_MEMORY_EOF
```

Nothing for a plain `approved` with no findings — that the loop worked is not
knowledge about the project, and memory is read by every step of every request.

## Output

Reminder before you write: one Write to `output_file` only — no code fences, no
commentary before or after. Every `{{…}}` is a value from the step context;
substitute it verbatim. `outcome` is the human's, not yours — copy it from
`inputs.signoff_file`. `findings` is `none`, or a count with its severity
breakdown. Still nothing edited, still no `gh`, still no fix applied.

**Write telegraphically.** Every line is a fragment, not a sentence.

---
id: {{frontmatter.id}}
workspace: {{frontmatter.workspace}}
slug: {{frontmatter.slug}}
status: {{frontmatter.status}}
step: {{frontmatter.step}}
reviewed_at: {{frontmatter.reviewed_at}}
request_ref: {{frontmatter.request_ref}}
scope_ref: {{frontmatter.scope_ref}}
commit_ref: {{frontmatter.commit_ref}}
signoff_ref: {{frontmatter.signoff_ref}}
branch: {{frontmatter.branch}}
base_branch: {{frontmatter.base_branch}}
outcome: <approved | followups | rejected>
findings: <none, or `<n> (<n> high, <n> medium, <n> low)`>
---

# Review: <short label for what was reviewed>

## Outcome
- <approved | followups | rejected> — <one line, in the human's own words>
- Branch: {{frontmatter.branch}} (local — published only if this approves)

## Audit
| Severity | Where | Finding |
|---|---|---|
| high | `<file:line>` | <one line — the concrete failure> |
(write `- none` when the audit found nothing)

## QA
| # | Checked | Result |
|---|---|---|
| 1 | <what the operator was asked to try> | <what they saw> |

## Delivered
- Against scope: <in bounds | what went outside it>
- Against request: <delivers it | the gap>

## Follow-ups
- <one line per request opened — its title>
(omit this section entirely when none were opened)
