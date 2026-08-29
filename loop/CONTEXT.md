# Loop vocabulary

Canonical terms for the dev loop (`loop/`). Full rationale for each is in
`README.md`; this is the fast lookup, not a replacement for it. `overseer.md`
and `loop/steps/*.md` keep their own compact, self-sufficient use of these
terms so the overseer never has to load this file (or `README.md`) mid-run —
reach for this file when adding a new step or doc and you need the settled
word for a concept, or when a term's meaning is unclear from context.

- **Request**: one unit of work moving through the loop, identified by
  `req_<timestamp>_<hash>`. Carries a `status` (see below) through
  `db/personal/index.jsonl`.
- **Step**: one stage a request passes through: `request`, `research`,
  `scope`, `plan`, `implement`, `verify`, `decide`, `commit`, `land`,
  `review`, `publish`, `close`.
- **Stint**: the working-tree lock held by one request at a time, from the
  start of `implement` until `land` commits. Covers `implement`, `verify`,
  `decide`, `commit`. `loop/bin/stint` reports the holder; `list --json`
  reports it as `lock`.
  _Avoid_: "the lock" as a standalone term — say "the stint" or "holds the
  stint" so it isn't confused with a request's `status`. Also avoid "phase"
  for this concept — see **Phase** below, a distinct term.
- **Phase**: an ordered batch of tracers *within one plan* (`### Phase 1`,
  `### Phase 2` in `steps/plan.md`'s output), scoped to one request. Later
  phases exist because they depend on an earlier one finishing first; within
  a phase, disjoint tracers run in parallel. Unrelated to **Stint** above —
  a phase is plan-time and per-request, a stint is a runtime lock that spans
  requests.
- **Train**: the chain of stacked branches for requests that have passed
  `commit` but not yet `close`d — each cut from the tip of the one ahead of
  it. `loop/bin/train` shows it. A request leaves the train only when `close`
  says its pull request landed (true even for a `rejected` review, whose
  branch stays local but stays in the train).
- **Tracer**: one unit of implementation work in a plan, grouped with other
  tracers that touch disjoint files into a **tracer group** — everything
  `implement --tracer` builds in one run. `loop/bin/tracers --next` /
  `--last` select the group.
- **Route**: the single next action a `decided` request carries: `implement`,
  `rework`, `plan`, `scope`, or `commit`. Chosen by `decide` (full conditions
  in `steps/decide.md`); acted on by the overseer (`overseer.md`'s route
  table).
- **Outcome**: the human's decision recorded by `review`: `approved`,
  `followups`, or `rejected`. Distinct from `route` — a route moves a request
  through the inner loop, an outcome ends it.
- **Status**: a request's position in the top-level cycle (`requested` →
  `researched` → `scoped` → `planned` → `implemented` → `verified` →
  `decided` → `committed` → `landed` → `reviewed` → `published` → `closed`).
  See `overseer.md`'s status table for what each one needs next.

## Flagged ambiguities

- "lock" could read as a synonym for **stint**. It isn't: **stint** is the
  concept; **lock** is only the literal `list --json` field name that reports
  who holds it.
- Resolved: the working-tree lock used to be called "the exclusive phase",
  colliding with `steps/plan.md`'s unrelated "Phase 1"/"Phase 2" (a plan's
  tracer batches). Renamed to **stint** throughout the code and docs so the
  two concepts no longer share a word.
