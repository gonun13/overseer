# AGENTS.md

## Spec-driven development

Authoritative product and engineering intent lives under `spec/`.
When specs disagree, respect them in this order (higher wins):

1. PROJECT — [`spec/PROJECT.md`](spec/PROJECT.md)
2. domain, architecture — [`spec/domain.md`](spec/domain.md), [`spec/architecture.md`](spec/architecture.md)
3. ui-ux, data — [`spec/ui-ux.md`](spec/ui-ux.md), [`spec/data.md`](spec/data.md)
4. behaviour, decisions — [`spec/behaviour/`](spec/behaviour/) (`overseer.md`, `consoles.md`,
   `dev-loop.md`), [`spec/decisions/`](spec/decisions/)
5. tests — [`spec/tests.md`](spec/tests.md)

Implement and review against these docs before inventing behaviour.

- When a decision record lands, update the spec section it changes in the same change, so the
  spec never needs a record to be read correctly and the order above never has to arbitrate.
- If code and spec disagree, do not silently pick one: fix the code to match the spec, or update the
  spec (with a record under `spec/decisions/` if it changes something already settled), and say
  which you did.
- Dev-loop vocabulary is [`loop/CONTEXT.md`](loop/CONTEXT.md) and the loop's runtime instructions are
  `loop/overseer.md` and `loop/steps/*.md`; they live in `loop/` because loop sessions read them,
  and they count as part of the spec at the behaviour level.
- To extend the spec: one file per new system or flow under `spec/behaviour/`; add `spec/<name>.md`
  only for a concern none of the files above covers, and add it to this list.

## Working in this repo

- Everything runs in Docker through `./bin/*` — never host `npm` or `node`. Dependency work is
  `./bin/npm` (README "Develop").
- Verify with `./bin/check`, `./bin/test`, and `./bin/test-e2e` where the operator would see the
  change ([`spec/tests.md`](spec/tests.md)).
- Operator-visible changes get a draft line under `## Unreleased` in `CHANGELOG.md`, following
  [`spec/architecture.md` §8.4](spec/architecture.md#84-changelog). Do not bump versions, commit,
  tag or push without the operator's say-so (§8.3).
