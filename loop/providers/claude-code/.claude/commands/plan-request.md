---
description: Plan a scoped dev-loop request into phases and vertical tracers; write the plan record.
argument-hint: <record-file> <research-file> <scope-file> <memory-file> <workspace-dir> <plan-file> <id> <workspace> <slug> <planned-at> <request-ref> <research-ref> <scope-ref>
allowed-tools: Read, Grep, Glob, Write
---

You are planning exactly one scoped feature/fix/change request for the
"dev loop" tool. This is an automated one-shot: read the inputs, decompose
the work, write exactly one plan file — nothing else.

Arguments, positional, in this order:
- $1 — absolute path to the request record (read-only)
- $2 — absolute path to the research report (read-only)
- $3 — absolute path to the scope decision (read-only; authority for in/out)
- $4 — absolute path to the slug's memory.md (read-only; may be missing)
- $5 — absolute path to the project workspace (read/explore only if needed)
- $6 — absolute path to write the plan record to
- $7 — request id
- $8 — workspace name
- $9 — slug
- $10 — planned_at, ISO 8601 UTC
- $11 — request_ref, relative path string (embed verbatim)
- $12 — research_ref, relative path string (embed verbatim)
- $13 — scope_ref, relative path string (embed verbatim)

## Vocabulary

- **Horizontal layer** — architectural stratum this request touches (named
  from the real codebase, not a fixed template).
- **Vertical layer** — cross-cutting concern that forces sequencing (auth,
  migrations, …) — only when it matters.
- **Phase** — ordered batch that should be done/verified before the next
  depends on it. Prefer few phases; one phase for tiny/audit/single-surface.
- **Vertical tracer** — thin end-to-end slice through horizontals;
  implementable and verifiable independently. Ids like `p1.t1`.

Layers = map; tracers = routes; phases = waves.

## Steps

1. Read $1, $2, $3. If $4 exists, read it. Use $5 with Grep/Glob/Read only
   when scope/research leave a concrete path or convention unclear — do not
   re-research the whole codebase.
2. Size the change from Decision Summary / In Scope / research file list.
3. Name implicated horizontal layers; list vertical layers only if they
   constrain order.
4. Split into 1..N phases, then tracers per phase with goal, owned paths,
   verify check. Same-phase `parallel: true` only when file ownership is
   disjoint. Parallelism is declared, never assumed.
5. Score **impact** (integer >= 1, lower = smaller blast radius):
   - 1 docs/audit/matrix-only, no product source edits
   - 2 single leaf file / pure additive local change
   - 3 one feature vertical; few coordinated files
   - 4 cross-cutting within one package/area
   - 5 multi-package or shared kernel / schema / auth
   - 6+ rare (migrations, permission model, multi-request coordination)
6. Call Write exactly once on $6 with the document below — no code fences,
   no commentary before or after.

Frontmatter values below are fixed inputs — copy each verbatim into its
field. Do not swap, reorder, or derive different values for $7–$13:
- `id:` ← $7
- `workspace:` ← $8
- `slug:` ← $9
- `planned_at:` ← $10
- `request_ref:` ← $11
- `research_ref:` ← $12
- `scope_ref:` ← $13
- `impact:` and `phase_count:` are your integers (>= 1)

Reminder before you write: one Write to $6 only.

---
id: $7
workspace: $8
slug: $9
status: planned
step: plan
planned_at: $10
request_ref: $11
research_ref: $12
scope_ref: $13
impact: <n>
phase_count: <n>
---

# Plan: <short label derived from the scope title>

## Impact
<score and one paragraph: blast radius — files, shared modules, migration
risk, user-visible surface>

## Layers
### Horizontal
- <layer> — <why this request touches it>

### Vertical
- <layer> — <why it forces sequencing>
(omit the Vertical subsection if none)

## Implementation Order

### Phase 1 — <name>
#### Tracer `p1.t1`
- Goal: <one line>
- Files/areas: <owned paths; disjoint from parallel siblings>
- Verify: <test, script, or observable acceptance item from scope>
- Parallel: false

<repeat tracers; add Phase 2… only when needed>

## Out of Plan
<echo scoped-out items an implementer might be tempted to do>

## Risks / Sequencing Notes
<why phase N waits on N-1; file-collision bans; omit if trivial single phase>
