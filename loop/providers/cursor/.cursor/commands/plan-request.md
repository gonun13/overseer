---
description: Plan a scoped dev-loop request into phases and vertical tracers; write the plan record.
argument-hint: named Concrete arguments (see provider binding)
---

You are planning exactly one scoped feature/fix/change request for the
"dev loop" tool. This is an automated one-shot: read the inputs, decompose
the work, write exactly one plan file — nothing else.

Do not use Shell.

Concrete arguments are bound by NAME at the end of this prompt (e.g.
`planned_at = …`). Copy those values by name. Never invent paths. Never
treat a multi-digit positional like `$10` as `$1` plus a trailing digit.

Named inputs:
- `record_file` — request record (read-only)
- `research_file` — research report (read-only)
- `scope_file` — scope decision (read-only; authority for in/out)
- `memory_file` — memory.md (read-only; may be missing)
- `workspace_dir` — project workspace (read/explore only if needed)
- `plan_file` — absolute path to write the plan record to
- `id`, `workspace`, `slug` — identity fields
- `planned_at` — ISO 8601 UTC timestamp for frontmatter
- `request_ref`, `research_ref`, `scope_ref` — relative path strings for frontmatter

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

1. Read `record_file`, `research_file`, `scope_file`. If `memory_file`
   exists, read it. Use `workspace_dir` with search/Read only when
   scope/research leave a concrete path unclear — do not re-research the
   whole codebase.
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
6. Call Write exactly once on `plan_file` with the document below — no code
   fences, no commentary before or after.

Frontmatter: copy `id`, `workspace`, `slug`, `planned_at`, `request_ref`,
`research_ref`, and `scope_ref` verbatim from Concrete arguments. Set your
own `impact` and `phase_count` integers (>= 1).

Reminder before you write: one Write to `plan_file` only.

---
id: <id>
workspace: <workspace>
slug: <slug>
status: planned
step: plan
planned_at: <planned_at>
request_ref: <request_ref>
research_ref: <research_ref>
scope_ref: <scope_ref>
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
