---
description: Analyze scoped requests, pick one with the human, then write that request's plan in the same session.
argument-hint: <bundle-json> <result-file> <workspace-dir>
allowed-tools: Read, Write, AskUserQuestion, Grep, Glob
---

You are choosing which scoped request to plan next for the "dev loop", then
you **continue in this same session** and write the plan for the chosen
request. Do not stop after the pick — planning is part of this turn of work.
When both the result file and the plan file are written, tell the human they
can exit this session; the loop continues automatically after they exit.

Arguments:
- $1 — absolute path to a JSON bundle (read-only) describing candidates
- $2 — absolute path to write the pick result record to
- $3 — absolute path to the project workspace (explore only if plan needs it)

## Step 1 — Read the bundle

Read $1. It has this shape:

```json
{
  "workspace": "...",
  "slug": "...",
  "planned_at": "ISO8601Z",
  "memory_file": "/abs/or/empty",
  "running": "none-or-json",
  "candidates": [
    {
      "id": "req_…",
      "title": "…",
      "scoped_at": "…",
      "record_file": "/abs/…",
      "research_file": "/abs/…",
      "scope_file": "/abs/…",
      "plan_file": "/abs/…",
      "request_ref": "db/…/requests/….md",
      "research_ref": "db/…/research/….md",
      "scope_ref": "db/…/scope/….md"
    }
  ]
}
```

If `running` is not `"none"`, another terminal holds the workspace — write an
empty pick result (`chosen` empty) and stop; do not plan.

## Step 2 — Analyze and ask

For each candidate, skim its `scope_file` (and `research_file` if needed) just
enough to compare blast radius and clarity. Prefer smaller / clearer work
first. Then:

- **One candidate:** you may select it without asking (still say so briefly).
- **Multiple:** use AskUserQuestion — recommend the lowest expected blast
  radius / clearest scope first, label it "(Recommended)", allow one id or
  "none / skip".

## Step 3 — Write the pick result

Call Write on $2 (exactly once for this file):

---
status: picked
chosen: <req_… or empty>
---

# Pick: plan next

## Rationale
<1-3 sentences>

If `chosen` is empty, stop here (tell the human they can exit). Do not plan.

## Step 4 — Plan the chosen request (same session)

Let C be the candidate object whose `id` equals `chosen`.

1. Read C.record_file, C.research_file, C.scope_file. If bundle.memory_file
   is non-empty and exists, read it. Use Grep/Glob/Read on $3 only when
   needed — not a full re-research.
2. Decompose into layers → phases → vertical tracers (`p1.t1` ids). Prefer
   few phases. Score impact (integer >= 1; lower = smaller blast radius).
3. Call Write exactly once on C.plan_file with the plan document below.
   Copy these frontmatter values **verbatim from the bundle / candidate**
   (do not invent; do not treat `$10` as `$1`+`0`):
   - `id` ← C.id
   - `workspace` ← bundle.workspace
   - `slug` ← bundle.slug
   - `planned_at` ← bundle.planned_at
   - `request_ref` ← C.request_ref
   - `research_ref` ← C.research_ref
   - `scope_ref` ← C.scope_ref
   - `impact` / `phase_count` ← your integers (>= 1)

---
id: <C.id>
workspace: <bundle.workspace>
slug: <bundle.slug>
status: planned
step: plan
planned_at: <bundle.planned_at>
request_ref: <C.request_ref>
research_ref: <C.research_ref>
scope_ref: <C.scope_ref>
impact: <n>
phase_count: <n>
---

# Plan: <short label>

## Impact
<score + one paragraph>

## Layers
### Horizontal
- <layer> — <why>

### Vertical
- <layer> — <why>
(omit Vertical if none)

## Implementation Order

### Phase 1 — <name>
#### Tracer `p1.t1`
- Goal: <one line>
- Files/areas: <owned paths>
- Verify: <check>
- Parallel: false

## Out of Plan
<echo scoped-out temptations>

## Risks / Sequencing Notes
<or omit if trivial>

After both writes succeed, tell the human: plan is done — they can exit this
session so the loop can record it and continue.
