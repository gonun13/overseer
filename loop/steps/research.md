# Step: research

Research exactly one feature/fix/change request against the real project, to
prepare context for the human scoping session that comes next. You write
exactly two files in this pass — the research report and the memory file —
and nothing else.

You were handed a **step context** JSON from `loop/bin/step`. Everything you
need is named in it:

- `inputs.request_file` — the request's structured record (read-only)
- `inputs.memory_file` — this workspace's accumulated knowledge from earlier
  research runs. It may not exist yet. You read it directly; you update it only
  through `loop/bin/memory` (see Output).
- `workspace_dir` — the actual project to explore (read only; never edit it)
- `output_file` — the research report to write
- `frontmatter` — frontmatter keys and values; copy each one **verbatim**

Never re-derive, reorder, or improve a value in `frontmatter`. Bash generated
those and `loop/bin/record` checks the file against exactly the same values, so
an altered one is rejected and the step has to be redone.

## Steps

1. Read `inputs.request_file` to understand what's being requested (title,
   summary, description, kind, acceptance criteria).
2. If `inputs.memory_file` exists, read it — prior accumulated knowledge about
   this codebase. Use it as context; don't restate what it already says, and
   don't re-verify what it already establishes unless this request touches it.
   Confirming a fact that is already written down produces no new knowledge and
   costs a full exploration pass.
3. Explore `workspace_dir` with Read/Grep/Glob. This is real, open-ended
   exploration — go as broad as you need to find the files and areas relevant
   to the request, the conventions that should be followed, and the risks or
   ambiguities scoping will have to resolve.
4. Only if local exploration leaves a genuine gap — e.g. the codebase depends
   on a library whose current documented API matters for scoping and isn't
   resolvable from the code itself — use WebSearch/WebFetch. A fallback for
   real gaps, not a default step: prefer what's already in the codebase
   (comments, lockfile versions, README) first.
5. From all of that, work out: relevant files/areas, existing conventions to
   follow, risks or unknowns, and open questions scoping will need to resolve.

## Output

Reminder before you write: exactly one Write — the report at `output_file` —
followed by one `loop/bin/memory` call. Never write `inputs.memory_file`
yourself. No code fences wrapping the report, no commentary before or after.

**First**, write `output_file`. Every `{{…}}` is a value from the step context;
substitute it verbatim.

---
id: {{frontmatter.id}}
workspace: {{frontmatter.workspace}}
slug: {{frontmatter.slug}}
status: {{frontmatter.status}}
step: {{frontmatter.step}}
researched_at: {{frontmatter.researched_at}}
request_ref: {{frontmatter.request_ref}}
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
<anything that could complicate scoping or implementation — omit this section
if there's genuinely nothing>

## Open Questions for Scoping
<concrete questions the human scoping session should resolve — omit this
section if there are none>

**Second**, update the memory — by piping a **delta** into `loop/bin/memory`,
never by writing the file:

```sh
loop/bin/memory {{frontmatter.workspace}} --merge --id {{frontmatter.id}} <<'LOOP_MEMORY_EOF'
## <section>
<the new body for that section, in full>
LOOP_MEMORY_EOF
```

Send **only the sections this pass actually changes.** Each `## Section` you
send replaces that section's body outright, so write the whole body you want it
to have. Every section you leave out is kept exactly as it was. That is the
point: the parts of memory this request did not touch cost you nothing to
preserve, and rewriting them is how the document doubles in size without
gaining a fact. The command writes the title and the `_Last updated:_` line
itself, so do not send them.

It prints the new size. If it says the document is over budget, your next pass
prunes — the sections it names have grown past being useful.

### The sections

**`## Commands`** — the project's own commands, one per line, and the literal
word `none` where the project has none. Establish these once, here, against the
real project; `verify` treats this block as authoritative and skips the check
outright on a `none`, so a wrong line here is a check that silently never runs
and a missing one is an archaeology dig on every lap of every request.

```
- test: none
- lint: none
- typecheck: ./node_modules/.bin/tsc --noEmit
- build: npm run generate
- dev: npm run dev
```

**`## Codebase Overview`** — a durable orientation: what this is, how it is
structured, where things live.

**`## Established Conventions & Patterns`** — what future requests and steps
should follow, so they are not re-discovered every time.

**`## Known Issues / Gotchas`** — what is surprising or easy to get wrong.

**`## Past Decisions & Rationale`** — why things are the way they are, when the
code does not say. You seed it; `decide` and `review` append to it as the loop
makes decisions worth keeping. Send nothing for it when you have nothing — an
empty section is dropped, and a placeholder saying so is worse than an absence,
because every step then pays to read a sentence that carries no information.

### How to write memory

**Memory states what is true now. It is not a log of when you learned it.**

- Never write that a fact was confirmed, re-confirmed, or still holds as of a
  date — `"Confirmed again on 2026-08-26"`, `"Reconfirmed …"`, `"(verified
  2026-08-27)"`. A fact in memory is asserted as current; if it stopped being
  true you would have changed it. These lines are pure cost: every step reads
  them on every run and none of them can act on one.
- Supersede rather than accumulate. When a finding replaces an older one, send
  the section back with the old wording gone — not with both and a date to tell
  them apart.
- Drop what stopped being relevant. Nothing is owed a place for having once
  been researched.
- Prefer the specific and checkable — a path, a command, a key name — over
  narration about the codebase.
- One request's open question is not memory. It goes in `output_file`.
