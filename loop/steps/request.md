# Step: request

Structure exactly one raw feature/fix/change request into the loop's request
record. A single deterministic pass — one Read, one Write, no filesystem
exploration, no questions back to the human, nothing beyond the steps below.

You were handed a **step context** JSON from `loop/bin/new`. Everything you
need is named in it:

- `inputs.raw_file` — the human's raw, unedited request text (read-only)
- `output_file` — the record to write
- `frontmatter` — frontmatter keys and values; copy each one **verbatim**
- `frontmatter_open` — the one key you must supply yourself: `kind`

Never re-derive, reorder, or improve a value in `frontmatter`. Bash generated
those and `loop/bin/record` checks the file against exactly the same values, so
an altered one is rejected and the step has to be redone.

## Steps

1. Read `inputs.raw_file`. Do not read or look at anything else.
2. Classify it as exactly one of: `feature`, `fix`, `change`. That is `kind`.
3. Write a short, specific title (under 80 characters).
4. Write a 1-3 sentence summary.
5. Write a cleaned-up description: preserve every concrete detail the human
   gave (numbers, names, constraints); fix grammar and structure only — never
   invent scope they did not ask for.
6. List acceptance criteria as concrete, testable bullets inferred from the
   request. If the request is too vague to derive any, omit the whole section —
   never fabricate criteria the human did not imply.
7. Suggest 1-5 short lowercase tags.

## Output

Reminder before you write: still a single deterministic pass — one Read already
done, one Write next, no exploration, no questions.

Call Write exactly once, targeting `output_file`, with this document and
nothing else — no code fences wrapping it, no commentary before or after. Every
`{{…}}` below is a value from the step context; substitute it verbatim.

---
id: {{frontmatter.id}}
workspace: {{frontmatter.workspace}}
slug: {{frontmatter.slug}}
kind: <feature|fix|change>
status: {{frontmatter.status}}
step: {{frontmatter.step}}
submitted_at: {{frontmatter.submitted_at}}
raw_ref: {{frontmatter.raw_ref}}
tags: [<tag>, <tag>]
---

# <Title>

## Summary
<summary>

## Description
<description>

## Acceptance Criteria
- <criterion>
