# Step: plan

Plan exactly one scoped feature/fix/change request: read the inputs, decompose
the work, write exactly one plan file — nothing else.

You were handed a **step context** JSON from `loop/bin/step`. Everything you
need is named in it:

- `inputs.request_file` — the request record (read-only)
- `inputs.research_file` — the research report (read-only)
- `inputs.scope_file` — the scope decision (read-only; the authority on in/out)
- `inputs.memory_file` — this workspace's accumulated knowledge (read-only; may
  not exist)
- `workspace_dir` — the project, to consult only when a concrete path is
  unclear (read only; never edit it)
- `output_file` — the plan to write
- `frontmatter` — frontmatter keys and values; copy each one **verbatim**
- `frontmatter_open` — the keys you must supply yourself: `impact`,
  `phase_count`

Never re-derive, reorder, or improve a value in `frontmatter`. Bash generated
those and `loop/bin/record` checks the file against exactly the same values, so
an altered one is rejected and the step has to be redone.

## Vocabulary

- **Horizontal layer** — architectural stratum this request touches, named from
  the real codebase, not a fixed template.
- **Vertical layer** — cross-cutting concern that forces sequencing (auth,
  migrations, …) — only when it matters.
- **Phase** — ordered batch that should be done and verified before the next
  depends on it. Prefer few phases; one phase for tiny/audit/single-surface work.
- **Vertical tracer** — thin end-to-end slice through the horizontals,
  implementable and verifiable independently. Ids like `p1.t1`.

Layers = map; tracers = routes; phases = waves.

## Steps

1. Read `inputs.request_file`, `inputs.research_file`, `inputs.scope_file`. If
   `inputs.memory_file` exists, read it. Use `workspace_dir` with
   Grep/Glob/Read only when scope and research leave a concrete path or
   convention unclear — do not re-research the codebase.
2. Size the change from the Decision Summary, In Scope, and research's file list.
3. Name the implicated horizontal layers; list vertical layers only if they
   constrain order.
4. Split into 1..N phases, then tracers per phase with a goal, owned paths, and
   a verify check. Same-phase `parallel: true` only when file ownership is
   disjoint. Parallelism is declared, never assumed.
5. **If `output_file` already exists, this is a re-plan.** `decide` sent the
   request back here, so read the plan that is there and keep the ids of every
   tracer you are carrying over — only genuinely new work gets a new id. The
   implement record's ledger is matched to the plan by tracer id, so renumbering
   silently re-opens finished work.
6. Score **impact** (integer >= 1, lower = smaller blast radius):
   - 1 docs/audit/matrix-only, no product source edits
   - 2 single leaf file / pure additive local change
   - 3 one feature vertical; few coordinated files
   - 4 cross-cutting within one package or area
   - 5 multi-package, or shared kernel / schema / auth
   - 6+ rare (migrations, permission model, multi-request coordination)

## Output

Reminder before you write: one Write to `output_file` only — no code fences, no
commentary before or after. Every `{{…}}` is a value from the step context;
substitute it verbatim. `impact` and `phase_count` are your own integers (>= 1).

---
id: {{frontmatter.id}}
workspace: {{frontmatter.workspace}}
slug: {{frontmatter.slug}}
status: {{frontmatter.status}}
step: {{frontmatter.step}}
planned_at: {{frontmatter.planned_at}}
request_ref: {{frontmatter.request_ref}}
research_ref: {{frontmatter.research_ref}}
scope_ref: {{frontmatter.scope_ref}}
impact: <n>
phase_count: <n>
---

# Plan: <short label derived from the scope title>

## Impact
<score and one paragraph: blast radius — files, shared modules, migration risk,
user-visible surface>

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
<why phase N waits on N-1; file-collision bans; omit if a trivial single phase>
