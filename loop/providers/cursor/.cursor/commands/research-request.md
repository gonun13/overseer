---
description: Research a dev-loop request's codebase context and update the slug's memory file.
argument-hint: <record-file> <workspace-dir> <memory-file> <research-file> <id> <workspace> <slug> <researched-at> <request-ref>
---

You are researching exactly one feature/fix/change request for the "dev
loop" tool, to prepare context for a human scoping session that comes next.
You must write exactly two files by the end of this pass: the research
report and the updated memory file — nothing else, and no other writes.

Do not use Shell. Explore with Read and codebase search tools only.

Arguments, positional, in this order:
- $1 — absolute path to the request's structured record (read-only input)
- $2 — absolute path to the actual project to research (read/explore only)
- $3 — absolute path to the slug's memory file — it may not exist yet; if
  it does, it holds accumulated knowledge from prior research runs
- $4 — absolute path to write the research report to
- $5 — request id
- $6 — workspace name
- $7 — slug
- $8 — researched_at, ISO 8601 UTC
- $9 — request_ref, a relative path string to embed verbatim (do not alter it)

Steps:
1. Read the file at $1 to understand what's being requested (title,
   summary, description, kind, acceptance criteria).
2. If $3 exists, read it — it's prior accumulated knowledge about this
   codebase from earlier research runs. Use it as context; don't restate
   what it already says.
3. Explore the codebase at $2 using Read and search tools. This is real,
   open-ended exploration (not a single deterministic pass) — go as broad
   as you need to find the files/areas relevant to the request, existing
   conventions that should be followed, and any risks or ambiguities.
4. Only if local exploration leaves a genuine gap — e.g. the codebase
   depends on a library or framework whose current documented API/behavior
   matters for scoping and isn't resolvable from the code itself — use
   WebFetch (or web search if available) to check internet documentation.
   This is a fallback for real gaps, not a default step: prefer what's
   already in the codebase (comments, lockfile versions, README) first,
   and don't fetch pages unrelated to a concrete question raised by your
   exploration.
5. From all of the above, work out: relevant files/areas, existing
   conventions to follow, risks or unknowns, and open questions the
   upcoming scoping session will need to resolve.

Reminder before you write: you must call Write exactly twice — once for the
research report at $4, once for the updated memory file at $3 — and
nothing else. No code fences wrapping either document, no commentary
before or after.

The five frontmatter values below are fixed inputs, already given to you as
arguments — copy each one verbatim into its own field. Do not swap them,
reorder them, or derive a different value for any of them:
- `id:` gets exactly the string from argument $5 (a request id — it starts
  with `req_`, it is never the workspace name)
- `workspace:` gets exactly the string from argument $6 (the workspace name
  — a short human word, e.g. `personal`)
- `slug:` gets exactly the string from argument $7 (the slug — usually the
  same short word as $6; it is never a timestamp)
- `researched_at:` gets exactly the string from argument $8 (an ISO 8601
  UTC timestamp, e.g. `2026-08-26T12:57:57Z`)
- `request_ref:` gets exactly the string from argument $9 (a relative path
  string, e.g. `db/personal/requests/req_....md`)

First, write $4 with this exact document:

---
id: $5
workspace: $6
slug: $7
status: researched
step: research
researched_at: $8
request_ref: $9
---

# Research: <short label derived from the request's title>

## Summary
<1-3 sentences: what this request needs from the codebase>

## Relevant Areas & Files
<the files/directories that matter, and why>

## Key Findings
<concrete things learned by exploring — conventions, existing patterns to
reuse, relevant APIs, anything scoping will need>

## Risks / Unknowns
<anything that could complicate scoping or implementation — omit this
section if there's genuinely nothing>

## Open Questions for Scoping
<concrete questions the human scoping session should resolve — omit this
section if there are none>

Second, write $3 (memory.md — no frontmatter; it isn't tied to one request,
it accumulates across every request for this workspace). If $3 already
existed, merge your new findings into it — update or remove anything this
research supersedes, and don't just append a duplicate of what's already
there. If it didn't exist, write it fresh with this shape:

# Memory — $6

_Last updated: $8 (research on $5)_

## Codebase Overview
<a durable orientation to this codebase — what it is, how it's structured>

## Established Conventions & Patterns
<things future requests/steps should follow, so they aren't re-discovered
every time>

## Known Issues / Gotchas
<anything surprising or easy to get wrong>

## Past Decisions & Rationale
<why things are the way they are, when it isn't obvious from the code>
