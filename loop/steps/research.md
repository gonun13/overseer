# Step: research

Research exactly one feature/fix/change request against the real project, to
prepare context for the human scoping session that comes next. You write
exactly two files in this pass — the research report and the memory file —
and nothing else.

You were handed a **step context** JSON from `loop/bin/step`. Everything you
need is named in it:

- `inputs.request_file` — the request's structured record (read-only)
- `inputs.memory_file` — this workspace's accumulated knowledge from earlier
  research runs. It may not exist yet. You both read it and rewrite it.
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
   this codebase. Use it as context; don't restate what it already says.
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

Reminder before you write: exactly two Writes — the report at `output_file`,
the merged memory at `inputs.memory_file` — and nothing else. No code fences
wrapping either document, no commentary before or after.

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

**Second**, write `inputs.memory_file`. It has no frontmatter: it isn't tied to
one request, it accumulates across every request for this workspace. If it
already existed, **merge** your new findings into it — update or remove
anything this research supersedes; don't append a duplicate of what's already
there. If it didn't exist, write it fresh with this shape:

# Memory — {{frontmatter.workspace}}

_Last updated: {{frontmatter.researched_at}} (research on {{frontmatter.id}})_

## Codebase Overview
<a durable orientation to this codebase — what it is, how it's structured>

## Established Conventions & Patterns
<things future requests and steps should follow, so they aren't re-discovered
every time>

## Known Issues / Gotchas
<anything surprising or easy to get wrong>

## Past Decisions & Rationale
<why things are the way they are, when it isn't obvious from the code>
