---
description: Interactively scope a dev-loop request with the human developer, write a decision record, then continue into the plan step in the same session.
argument-hint: <record-file> <research-file> <decision-file> <id> <workspace> <slug> <scoped-at> <request-ref> <research-ref> <plan-file> <planned-at> <scope-ref> <workspace-dir> <memory-file>
allowed-tools: Read, Write, AskUserQuestion, WebFetch, WebSearch, Grep, Glob
---

You are scoping exactly one feature/fix/change request for the "dev loop"
tool, together with the human developer who is sitting at this terminal
right now. After the scope decision is written, you continue in this same
session into the **plan** step for that request — so the human leaves with
both a scope decision and a plan. Get the important things confirmed; don't
waste the human's attention on things you can just decide well.

Arguments, positional, in this order:
- $1 — absolute path to the request's structured record (read-only input)
- $2 — absolute path to the research report (read-only input)
- $3 — absolute path to write the scope decision record to
- $4 — request id
- $5 — workspace name
- $6 — slug
- $7 — scoped_at, ISO 8601 UTC
- $8 — request_ref, a relative path string to embed verbatim (do not alter it)
- $9 — research_ref, a relative path string to embed verbatim (do not alter it)
- $10 — absolute path to write the plan record to
- $11 — planned_at, ISO 8601 UTC (embed verbatim in the plan frontmatter)
- $12 — scope_ref, relative path string for the plan frontmatter (embed verbatim)
- $13 — absolute path to the project workspace (explore only if plan needs it)
- $14 — absolute path to memory.md (may be missing; read-only)

## Step 1 — Read, don't explore

Read $1 (title, summary, description, kind, acceptance criteria) and $2
(relevant areas/files, key findings, risks/unknowns, open questions the
research step flagged for you). That is your context. Do not use Glob or
Grep yet, and do not go looking through the codebase for anything beyond
these two files — research already did that exploration; your job in Steps
1–3 is to turn what it found into a bounded, decided scope with the human.

The one exception: if a live design question comes up during Step 2 that
hinges on external, factual information research didn't cover (e.g. a
library's current documented API/behavior), you may use WebSearch/WebFetch
to check it on the spot rather than guessing or leaving it as an assumption.
This is a narrow fallback for a genuine gap, same bar as research's own use
of these tools — not a default step, and never a substitute for reading $1/$2
first.

## Step 2 — Grill the human (at most 20 questions)

Have a real conversation. This is not a form to fill in — ask one thing at
a time, listen to the answer, and let it change what you ask next (an
answer may resolve a question you hadn't asked yet, or open one you
didn't expect).

**A hard ceiling of 20 questions, not a quota.** Stop as soon as the
important things are resolved — 6 sharp questions that settle real
ambiguity beats 20 that pad out a checklist. If you hit 20 and unresolved
items remain, stop anyway and record what's left under "Open Follow-ups" in
the decision record — the human can pick it back up in another scoping
pass.

**Decide who a question is for.** Before asking anything, sort it:
- **Ask the human** when it changes the shape of the work: architecture or
  design choices, data model, what's explicitly in vs. out of scope for
  this iteration, UX/behavior decisions a user would notice, anything the
  research report flagged as an open question or a risk, anything where
  getting it wrong is expensive to undo later, or anything genuinely a
  matter of the human's taste or priorities (not yours to guess).
- **Decide it yourself, silently, via best practice** when it's a small
  implementation doubt with a conventional, low-risk answer — naming,
  minor formatting, which existing utility to reuse, ordinary error
  handling, things any competent engineer would resolve the same way
  without asking. Record these under "Assumptions" in the decision
  record with a one-line reason. Never spend one of the 20 questions on
  these.

**Always propose a recommendation when you ask.** For every question you do
put to the human, come in with a position — your best-judgment answer and
why — not a blank "what do you want?". When a question reduces to a
discrete set of choices, use AskUserQuestion: put your recommended option
first and label it "(Recommended)" in its label, and write the option
descriptions so the tradeoff is legible at a glance. When a question is
genuinely open-ended (no fixed set of options fits), ask it as plain
conversational text instead, but still lead with your own recommendation
so the human can just confirm it rather than having to compose an answer
from nothing.

**Prioritize.** Order matters: ask about things that would reshape the rest
of the scoping conversation first (e.g. "should this touch the API at all,
or stay UI-only?") before drilling into details that only matter once the
shape is settled. If research surfaced explicit open questions, treat those
as strong candidates for your question budget — they were flagged for
exactly this moment.

The human may also volunteer constraints or answer things you hadn't asked
yet — track that, and don't re-ask something already answered.

## Step 3 — Confirm and write scope

Once you've resolved what you need (whether that's after 3 questions or
20), summarize in plain text what you're about to record — in scope, out of
scope, and the key decisions — and give the human a chance to correct
anything before you write. This confirmation does not count against the
20-question budget; it's a final sanity check, not more scoping.

Then call Write exactly once, targeting the path in $3, with this exact
markdown document and nothing else — no code fences wrapping it, no
commentary before or after.

The frontmatter values below are fixed inputs, already given to you as
arguments — copy each one verbatim into its own field. Do not swap them,
reorder them, or derive a different value for any of them:
- `id:` gets exactly the string from argument $4 (a request id — it starts
  with `req_`, it is never the workspace name)
- `workspace:` gets exactly the string from argument $5 (the workspace name
  — a short human word, e.g. `personal`)
- `slug:` gets exactly the string from argument $6 (the slug — usually the
  same short word as $5; it is never a timestamp)
- `scoped_at:` gets exactly the string from argument $7 (an ISO 8601 UTC
  timestamp, e.g. `2026-08-26T13:40:00Z`)
- `request_ref:` gets exactly the string from argument $8 (a relative path
  string, e.g. `db/personal/requests/req_....md`)
- `research_ref:` gets exactly the string from argument $9 (a relative path
  string, e.g. `db/personal/research/req_....md`)
- `questions_asked:` gets the actual number of questions you put to the
  human in Step 2 (an integer, 0-20 — never the confirmation in Step 3)

---
id: $4
workspace: $5
slug: $6
status: scoped
step: scope
scoped_at: $7
request_ref: $8
research_ref: $9
questions_asked: <n>
---

# Scope: <short label derived from the request's title>

## Decision Summary
<1-3 sentences: what this iteration will actually do, in plain terms>

## In Scope
- <bullet>

## Out of Scope
<explicitly deferred or rejected, each with a one-line why when it isn't
obvious>

## Decisions
### <question or topic>
- Recommendation: <what you proposed, and why>
- Decision: <what was actually decided — often the same as the recommendation>
- Rationale: <the human's reasoning, or yours if they accepted your default>

<repeat this block once per question that was actually put to the human —
omit the whole section only if you asked nothing, which should be rare>

## Assumptions (Not Asked)
<small doubts you resolved yourself via best practice, one line each with a
brief why — these were never put to the human>

## Risks Accepted
<risks (including any the research report flagged) that the human
explicitly chose to carry forward rather than eliminate — omit if none>

## Open Follow-ups
<anything left genuinely unresolved because you hit the 20-question ceiling
or the human deferred it — omit this section if there's nothing left open>

## Step 4 — Plan in this same session

Immediately after the scope Write succeeds, plan the work. Tell the human
you are moving to the plan step. You may briefly confirm the phase shape if
something is ambiguous; do not re-open scoping.

**Vocabulary:** horizontal layers (architectural strata), vertical layers
(cross-cutting sequencing constraints — only when needed), phases (ordered
batches), vertical tracers (thin end-to-end slices, ids like `p1.t1`).
Layers = map; tracers = routes; phases = waves.

1. If $14 exists, read it. Use Grep/Glob/Read on $13 only when scope/research
   leave a concrete path unclear — not a full re-research.
2. Prefer few phases; one phase for tiny/audit/single-surface work.
3. Each tracer: goal, owned paths, verify check; `parallel: true` only with
   disjoint file ownership in the same phase.
4. Score **impact** (integer >= 1, lower = smaller blast radius):
   1 docs/audit-only; 2 single leaf; 3 one feature vertical; 4 cross-cutting
   in one area; 5 multi-package/schema/auth; 6+ rare.
5. Call Write exactly once on $10 with the plan document below — no code
   fences, no commentary. Fixed frontmatter from arguments:
   - `id:` ← $4
   - `workspace:` ← $5
   - `slug:` ← $6
   - `planned_at:` ← $11
   - `request_ref:` ← $8
   - `research_ref:` ← $9
   - `scope_ref:` ← $12
   - `impact:` / `phase_count:` your integers (>= 1)

---
id: $4
workspace: $5
slug: $6
status: planned
step: plan
planned_at: $11
request_ref: $8
research_ref: $9
scope_ref: $12
impact: <n>
phase_count: <n>
---

# Plan: <short label derived from the scope title>

## Impact
<score and one paragraph: blast radius>

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
