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

The one exception: if a live design question comes up in Step 2 that hinges on
external, factual information research didn't cover (e.g. a library's current
documented API), you may use WebSearch/WebFetch to check it on the spot rather
than guessing. A narrow fallback for a genuine gap — never a substitute for
reading the two files first.

## Step 2 — Grill the human (at most 20 questions)

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

## Step 3 — Confirm and write

Once you've resolved what you need — whether that took 3 questions or 20 —
summarize in plain text what you're about to record (in scope, out of scope,
key decisions) and give the human a chance to correct it before you write. This
confirmation does not count against the 20-question budget.

Then call Write exactly once, targeting `output_file`, with this document and
nothing else — no code fences, no commentary before or after. Every `{{…}}` is
a value from the step context; substitute it verbatim. `questions_asked` is the
number of questions you actually put to the human in Step 2 (an integer, 0-20 —
never counting the Step 3 confirmation).

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
