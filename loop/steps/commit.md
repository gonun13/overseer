# Step: commit

Write the commit message and the pull-request body for one finished request.
Exactly one commit record. You do not run git, you do not open the pull
request, and you do not touch the project — `loop/bin/land` does all three,
after this record has been validated.

The work is already done and already judged. `decide` routed this request here
because every tracer in its plan is implemented and the last verify passed.
Your job is to say what it changed and why, to someone who has never heard of
this tool.

You were handed a **step context** JSON from `loop/bin/step`. Everything you
need is named in it:

- `inputs.request_file` — what was asked for: the title, the summary, the
  acceptance criteria (read-only)
- `inputs.implement_file` — what was built: the tracer ledger, the per-tracer
  changes, the deviations (read-only)
- `inputs.decide_file` — the decision blocks, ending in the one that routed
  this request here (read-only)
- `inputs.memory_file` — this workspace's accumulated knowledge (read-only; may
  not exist)
- `workspace_dir` — the project. You **read** its git history and its diff; you
  change nothing in it.
- `output_file` — the commit record to write
- `frontmatter` — frontmatter keys and values; copy each one **verbatim**.
  `branch` and `base_branch` are among them: bash cut that branch when this
  request took the working tree, and it is already checked out.
- `frontmatter_open` — the one key you must supply yourself: `pr_title`

Never re-derive, reorder, or improve a value in `frontmatter`. Bash generated
those and `loop/bin/record` checks the file against exactly the same values, so
an altered one is rejected and the step has to be redone. That applies to
`branch` and `base_branch` above all: they are read back out of the repository,
and a "tidier" branch name is simply wrong.

## Standing rules

1. **Do not run a git command that writes.** No `add`, `commit`, `push`,
   `branch`, `checkout`, `switch`, `stash`, `merge`, `rebase`, `reset`, `tag`.
   A message you write is not a commit you make. Bash commits, pushes and
   opens the pull request, so that the verbs nobody can undo stay somewhere
   deterministic.
2. **Read the repository freely.** These are the ones you want, and they are
   how you write a message worth reading:
   - `git -C <workspace_dir> status --short`
   - `git -C <workspace_dir> diff --stat <base_branch>...<branch>`
   - `git -C <workspace_dir> diff <base_branch>...<branch>`
   - `git -C <workspace_dir> log --oneline -10`
   Read the actual diff. A message written only from the implement record
   describes what was planned, not what was written.
3. **Do not use `gh`, and do not push.** The branch stays on this machine until
   a human has reviewed it and approved it; `loop/bin/publish` opens the pull
   request then. You write the title and body it will use — writing them is
   free, opening the pull request is what is public.
4. **Change no file under `workspace_dir`**, and write nothing anywhere except
   `output_file`.
5. **Write for a stranger.** No tracer ids, no phase numbers, no request id, no
   loop jargon in the commit message or the pull-request body. Somebody reading
   `git log` in a year has none of this context and needs none of it.

## Steps

1. Read `inputs.request_file` — what was asked for, and in whose words.
2. Read `inputs.implement_file` — the ledger and the per-tracer changes.
3. Read the last `## Decision` block of `inputs.decide_file` — the verdict this
   commit rests on.
4. Read the diff for the range in rule 2. This is the authority on what
   actually changed; where it and the implement record disagree, the diff wins.
5. Write the commit message: an imperative subject under 72 characters, a blank
   line, then a body wrapped at 72 saying what changed and why.
6. Write `pr_title` — one line, under 72 characters. It may be the subject.
7. Write the pull-request body: what changed, how it was verified, and what a
   reviewer should look hardest at. Name the risky parts; a reviewer's
   attention is the scarce thing here, and this body is what the `review` step
   reads before deciding whether any of this becomes public.

## Output

Reminder before you write: one Write to `output_file` only — no code fences, no
commentary before or after. Every `{{…}}` is a value from the step context;
substitute it verbatim, `branch` and `base_branch` included. Still no git that
writes, still no `gh`, still nothing edited under `workspace_dir`.

The two `##` sections below are parsed by `loop/bin/land` — the commit message
and the pull-request body are taken from them literally. Keep the headings
exactly as written.

**Write telegraphically** in the record's own sections. The commit message and
the pull-request body are the exception: those are prose for people, and they
should read like it.

---
id: {{frontmatter.id}}
workspace: {{frontmatter.workspace}}
slug: {{frontmatter.slug}}
status: {{frontmatter.status}}
step: {{frontmatter.step}}
committed_at: {{frontmatter.committed_at}}
request_ref: {{frontmatter.request_ref}}
implement_ref: {{frontmatter.implement_ref}}
decide_ref: {{frontmatter.decide_ref}}
branch: {{frontmatter.branch}}
base_branch: {{frontmatter.base_branch}}
pr_title: <one line, under 72 characters>
---

# Commit: <short label for what is being committed>

## Commit message
<imperative subject, under 72 characters>

<body, wrapped at 72. What changed and why. No tracer ids, no request id,
no loop vocabulary.>

## PR body
### Summary
- <what this delivers, one fragment per point>

### What changed
- `<path>` — <what changed there>

### Verification
- <what was run, and what it said — from the implement and verify records>

### Review notes
- <what a reviewer should look hardest at, and why>

### Out of scope
- <what this deliberately does not do>
(omit this section if nothing was deferred)

## Contents
- Tracers: <how many, from the ledger — all of them are done or this would not be here>
- Files: <how many changed, from `git diff --stat`>
- Base: <the branch this was cut from, and why it is that one — the request in
  front of it in the train, or the default branch when nothing was ahead>
