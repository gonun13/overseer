---
description: Structure a raw dev-loop request into a markdown record for loop/db.
argument-hint: <raw-file> <record-file> <id> <workspace> <slug> <submitted-at> <raw-ref>
allowed-tools: Read, Write
---

You are structuring exactly one raw feature/fix/change request for the "dev
loop" tool. This is a single deterministic pass — one Read, one Write, no
filesystem exploration, no follow-up questions, nothing beyond the steps
below.

Arguments, positional, in this order:
- $1 — absolute path to the raw request text file (read-only input)
- $2 — absolute path to write the output markdown record to
- $3 — request id
- $4 — workspace name
- $5 — slug
- $6 — submitted_at, ISO 8601 UTC
- $7 — raw_ref, a relative path string to embed verbatim (do not alter it)

Steps:
1. Read the file at $1 — the human's raw, unedited request text. Do not read
   or look at anything else.
2. Classify it as exactly one of: `feature`, `fix`, `change`.
3. Write a short, specific title (under 80 characters).
4. Write a 1-3 sentence summary.
5. Write a cleaned-up description: preserve every concrete detail the human
   gave (numbers, names, constraints); fix grammar and structure only —
   never invent scope they did not ask for.
6. List acceptance criteria as concrete, testable bullets inferred from the
   request. If the request is too vague to derive any, omit the whole
   section — never fabricate criteria the human did not imply.
7. Suggest 1-5 short lowercase tags.

Reminder before you write: this is still a single deterministic pass — one
Read already done, one Write next, no exploration, no questions back to the
human. Now call Write exactly once, targeting the path in $2, with this
exact markdown document and nothing else — no code fences wrapping it, no
commentary before or after:

---
id: $3
workspace: $4
slug: $5
kind: <feature|fix|change>
status: requested
step: request
submitted_at: $6
raw_ref: $7
tags: [<tag>, <tag>]
---

# <Title>

## Summary
<summary>

## Description
<description>

## Acceptance Criteria
- <criterion>