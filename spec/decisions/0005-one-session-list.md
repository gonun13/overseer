# One session list

The left rail's session panel split its list into **sessions** and **shells**, headed the first group
with the active project's name, and gave every row a provider (or `shell`) note beside its project.
On a narrow rail that was more label than list.

What this changes in settled spec: the panel is one ungrouped list — every console (agent, loop and
shell) in start order, then the active project's dormant sessions — with no section headings. A row
is its light, its name, a `·` and its project, `<n> queued` while relays wait, and its kill, dismiss
or delete icon; it no longer names the provider. Updated
`ui-ux.md` §1 and §6, and `behaviour/relay.md` §6.
