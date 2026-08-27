---
description: Analyze scoped requests, pick one with the human, then write that request's plan in the same session.
argument-hint: named Concrete arguments (bundle_file, result_file, workspace_dir)
---

You are choosing which scoped request to plan next for the "dev loop", then
you **continue in this same session** and write the plan for the chosen
request. Do not stop after the pick — planning is part of this turn of work.
When both the result file and the plan file are written, tell the human they
can exit this session; the loop continues automatically after they exit.

Do not use Shell.

Concrete arguments are bound by NAME at the end of this prompt:
- `bundle_file` — JSON describing candidates (read-only)
- `result_file` — path to write the pick result
- `workspace_dir` — project workspace (explore only if plan needs it)

## Step 1 — Read the bundle

Read `bundle_file` immediately. Shape:

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

If `running` is not `"none"`, write an empty pick result and stop.

## Step 2 — Analyze and ask (plain conversation)

Skim each candidate's `scope_file` (and `research_file` if needed). Prefer
smaller / clearer blast radius.

**Ask in plain text in this chat** — do not call any special question tool.
Print a short comparison and your recommendation, then ask the human to reply
with one request id (or "none"). Wait for their reply before writing anything.

One candidate: you may select it without asking (say so briefly).

## Step 3 — Write the pick result

Write `result_file` once:

---
status: picked
chosen: <req_… or empty>
---

# Pick: plan next

## Rationale
<1-3 sentences>

If `chosen` is empty, stop (tell the human they can exit). Do not plan.

## Step 4 — Plan the chosen request (same session)

Let C be the candidate whose `id` equals `chosen`.

1. Read C.record_file, C.research_file, C.scope_file. If memory_file is
   non-empty and exists, read it. Light Grep/Read on `workspace_dir` only
   if needed.
2. Decompose into layers → phases → tracers (`p1.t1`). Score impact (>= 1).
3. Write C.plan_file once. Copy by NAME from the bundle/candidate — never
   invent; never treat `$10` as `$1`+`0`:
   - id ← C.id
   - workspace ← bundle.workspace
   - slug ← bundle.slug
   - planned_at ← bundle.planned_at
   - request_ref ← C.request_ref
   - research_ref ← C.research_ref
   - scope_ref ← C.scope_ref
   - impact / phase_count ← your integers

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
(omit if none)

## Implementation Order

### Phase 1 — <name>
#### Tracer `p1.t1`
- Goal: <one line>
- Files/areas: <owned paths>
- Verify: <check>
- Parallel: false

## Out of Plan
<scoped-out temptations>

## Risks / Sequencing Notes
<or omit>

Then tell the human: plan is done — exit this session so the loop can record it.
