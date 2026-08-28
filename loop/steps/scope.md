# Step: scope

Scope exactly one feature/fix/change request together with the human developer
sitting at this terminal right now. Get the important things confirmed; don't
waste the human's attention on things you can just decide well.

This step ends when the scope decision record is written. Planning is a
separate step the overseer runs next — do not start it here.

You were handed a **step context** JSON from `loop/bin/step`. Everything you
need is named in it:

- `inputs.request_file` — the request's structured record (read-only)
- `inputs.research_file` — the research report (read-only)
- `inputs.memory_file` — this workspace's accumulated knowledge (read-only here;
  may not exist)
- `output_file` — the scope decision record to write
- `frontmatter` — frontmatter keys and values; copy each one **verbatim**
- `frontmatter_open` — the key you must supply yourself: `questions_asked`

Never re-derive, reorder, or improve a value in `frontmatter`. Bash generated
those and `loop/bin/record` checks the file against exactly the same values, so
an altered one is rejected and the step has to be redone.

## Step 1 — Read, don't explore

Read `inputs.request_file` (title, summary, description, kind, acceptance
criteria) and `inputs.research_file` (relevant areas/files, key findings,
risks/unknowns, the open questions research flagged for you). That is your
context. Do not go looking through the codebase beyond these two files —
research already did that exploration; your job is to turn what it found into a
bounded, decided scope with the human.

The one exception: if a live design question comes up in Step 3 that hinges on
external, factual information research didn't cover (e.g. a library's current
documented API), you may use WebSearch/WebFetch to check it on the spot rather
than guessing. A narrow fallback for a genuine gap — never a substitute for
reading the two files first.

## Step 2 — Check this belongs in the loop

Before you spend a single question on *how* to do the work, settle whether the
loop should be doing it at all. **This loop delivers code changes.** Every step
after this one assumes there will be a diff: `implement` writes it, `verify`
runs it, `commit` describes it, and `land` commits it. A request that changes
no file has nothing for any of them to work on, and dead-ends at `land` with
nothing to commit — after a full plan/implement/verify/decide cycle has been
spent on it.

So ask yourself, from the request and the research: **when this is done, which
files under `workspace_dir` will be different?**

If you cannot name any, the request is an audit, a review, a recommendation, an
investigation, or a question. Those are real and often valuable — they are just
not this loop's job, and an agent asked directly answers them in one pass
instead of seven steps. Say so, plainly, and put it to the human as a choice:

1. **Take it out of the loop** — they get the answer from an agent directly,
   and the request is cleared. Recommend this when the request is genuinely a
   question.
2. **Reshape it into a change** — the audit is the means, not the end, and what
   they actually want is the edit it implies ("remove the skills that don't
   belong" rather than "review whether the skills belong"). Scope *that*, and
   carry on to Step 3.
3. **Keep it as-is anyway** — they want the written record in `db/` and accept
   that it commits nothing. Carry on to Step 3, and say in `## Out of Scope`
   that this produces no code change, so nobody is surprised at `land`.

If they take option 1, **stop here and write nothing.** Do not create the scope
record. Nothing has been recorded for this request yet, so leaving it unwritten
costs nothing — report back that the request is audit-only and the human chose
to take it out of the loop, and the overseer will clear it.

A request that plainly changes files needs none of this. Do not put the
question to the human when the answer is obvious — that is a wasted turn, and
this step already spends enough of their attention.

## Step 3 — Grill the human (at most 20 questions)

Have a real conversation. This is not a form to fill in — ask one thing at a
time, listen to the answer, and let it change what you ask next (an answer may
resolve a question you hadn't asked yet, or open one you didn't expect).

**A hard ceiling of 20 questions, not a quota.** Stop as soon as the important
things are resolved — 6 sharp questions that settle real ambiguity beats 20
that pad out a checklist. If you hit 20 and unresolved items remain, stop
anyway and record what's left under "Open Follow-ups" — the human can pick it
back up in another scoping pass.

**Decide who a question is for.** Before asking anything, sort it:

- **Ask the human** when it changes the shape of the work: architecture or
  design choices, data model, what's explicitly in or out of scope for this
  iteration, UX/behavior decisions a user would notice, anything research
  flagged as an open question or a risk, anything expensive to undo later, or
  anything genuinely a matter of the human's taste or priorities.
- **Decide it yourself, silently, via best practice** when it's a small
  implementation doubt with a conventional, low-risk answer — naming, minor
  formatting, which existing utility to reuse, ordinary error handling. Record
  these under "Assumptions" with a one-line reason. Never spend one of the 20
  questions on these.

**Always propose a recommendation when you ask.** Come in with a position —
your best-judgment answer and why — not a blank "what do you want?".

When a question reduces to a discrete set of choices, put it to them as a pick
from a list rather than as prose: use a structured question tool if you have
one, otherwise print the options as a numbered list and say a number is what
you want back (accept the number, or the option's own words). Either way the
recommended option comes first and is marked "(Recommended)", and each option
carries enough description to make the tradeoff legible at a glance.

When a question is genuinely open-ended — no fixed set of options fits — ask it
as plain conversational text, but still lead with your own recommendation so
the human can just confirm it rather than composing an answer from nothing.

**Prioritize.** Ask about things that would reshape the rest of the
conversation first ("should this touch the API at all, or stay UI-only?")
before drilling into details that only matter once the shape is settled. If
research surfaced explicit open questions, treat those as strong candidates for
your question budget — they were flagged for exactly this moment.

The human may also volunteer constraints or answer things you hadn't asked
yet — track that, and don't re-ask something already answered.

## Step 4 — Confirm and write

Once you've resolved what you need — whether that took 3 questions or 20 —
summarize in plain text what you're about to record (in scope, out of scope,
key decisions) and give the human a chance to correct it before you write. This
confirmation does not count against the 20-question budget.

Then call Write exactly once, targeting `output_file`, with this document and
nothing else — no code fences, no commentary before or after. Every `{{…}}` is
a value from the step context; substitute it verbatim. `questions_asked` is the
number of questions you actually put to the human in Step 3 (an integer, 0-20 —
never counting the Step 4 confirmation).

---
id: {{frontmatter.id}}
workspace: {{frontmatter.workspace}}
slug: {{frontmatter.slug}}
status: {{frontmatter.status}}
step: {{frontmatter.step}}
scoped_at: {{frontmatter.scoped_at}}
request_ref: {{frontmatter.request_ref}}
research_ref: {{frontmatter.research_ref}}
questions_asked: <n>
---

# Scope: <short label derived from the request's title>

## Decision Summary
<1-3 sentences: what this iteration will actually do, in plain terms>

## In Scope
- <bullet>

## Files this will change
- `<path or area>` — <what changes there>
<the concrete answer to Step 2, carried forward: what `implement` will edit and
`commit` will describe. Write `none — this request produces no code change` only
if the human chose option 3 in Step 2.>

## Out of Scope
<explicitly deferred or rejected, each with a one-line why when it isn't
obvious>

## Decisions
### <question or topic>
- Recommendation: <what you proposed, and why>
- Decision: <what was actually decided — often the same as the recommendation>
- Rationale: <the human's reasoning, or yours if they accepted your default>

<repeat this block once per question actually put to the human — omit the whole
section only if you asked nothing, which should be rare>

## Assumptions (Not Asked)
<small doubts you resolved yourself via best practice, one line each with a
brief why — these were never put to the human>

## Risks Accepted
<risks (including any research flagged) the human explicitly chose to carry
forward rather than eliminate — omit if none>

## Open Follow-ups
<anything left genuinely unresolved because you hit the 20-question ceiling or
the human deferred it — omit if there's nothing left open>

When the Write succeeds, say so and stop. Do not plan — the overseer runs the
plan step next, and it will hand a fresh step context to whoever does it.
