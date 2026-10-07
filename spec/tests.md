# Tests — How to Verify

How this repo is tested, how to check a change against the spec, and when each gate runs. Every
command below runs **inside Docker** through `bin/*`; host `npm`/`node` is not a supported way to
run anything ([PROJECT.md](PROJECT.md) requirement 1).

---

## 1. The gates

| Gate | Command | What it runs |
|---|---|---|
| Typecheck + lint + format | `./bin/check` | `tsc --noEmit` in every workspace; `oxlint` in `packages/web`; `prettier --check .` at the root (Markdown excluded, see `.prettierignore`; fix with `./bin/npm run format`) |
| Unit + integration | `./bin/test` | `node:test` in every workspace that has tests — `tsx --test` for server and adapters, `node --experimental-strip-types --test` for web |
| Acceptance | `./bin/test-e2e [playwright args]` | Playwright, Chromium, in the dev stack's `e2e` service against `web:5173` |
| Dev loop | `./bin/loop check` → `loop/bin/check` | `bash -n` on every loop script, `shellcheck` (warning/error diagnostics, local rule suppressions), and `check-providers` |
| Provider registry | `loop/bin/check-providers` | each manifest's CLI and config directory stay inside its own bundle; every manifest with an `install` has a matching `# provider-cli: <id>` marker in the `Dockerfile`, and no marker lacks a manifest |

`./bin/check` and `./bin/test` share the full stack's deps gate, so the built `protocol` and
adapter packages they import are current.

## 2. Where tests live

| Package | Directory | Covers |
|---|---|---|
| `server` | `packages/server/test/*.test.ts` | console registry, callsigns and relay, discovery, session index and transcript monitor, overseer space, memory reset, personality validation, provider registry, usage, login broker, git (`vcs`) and its wire handlers, loop config and leases, workspace monitor; isolated Codex CLI resume and zero-token status |
| `web` | `packages/web/test/*.test.ts` | pure state: signals, space store, layout grid, commands, changelog parser, file view, session rail, git actions |
| `adapters/claude` | `packages/adapters/claude/test/` | console command line, hooks and relay input, transcript (JSONL) parsing, session titles, login, usage — with recorded fixtures in `test/fixtures/` |
| `adapters/codex` | `packages/adapters/codex/test/` | device login, cancellation, deadlines, quotas, native threads and isolated pinned-CLI persistence |
| `adapters/cursor` | `packages/adapters/cursor/test/` | adapter, transcripts, usage |
| `e2e` | `packages/e2e/tests/*.spec.ts` | boot and wizard (`smoke`), overseer space, consoles, git access, loop providers, changelog window |

## 3. Conventions

- **Undocumented CLI surfaces are pinned by fixtures.** Transcript shapes, login prompts and usage
  output are scraped from pinned CLI versions; a test fixture records what was observed so a CLI
  upgrade that changes it fails here, inside the adapter, and nowhere else.
- **E2E is serial, one world.** Tests share one server, one `overseer-personality` and one
  `state.json`, and the wizard's opening depends on what the last run left — so `workers: 1`, no
  `fullyParallel`. Timeouts are long (90s) because a boot is a paced sequence, not a page load.
  Truthy `CI` forbids focused tests, enables two retries and HTML reports; otherwise
  there are zero retries and a list reporter.
  `global-setup.ts` waits until the stack actually answers successfully (HTTP 2xx) before any test runs.
- **Web tests stay pure.** Rules that matter — signal derivation, tiling, parsing — are written as
  plain functions in `packages/web/src/state` and friends so they can be tested without a browser;
  only flows that need a real page go to e2e.
- **The browser MCP is not a test.** The Playwright MCP in `.mcp.json` is for click-through against
  a running stack; acceptance tests run only via `./bin/test-e2e`.

## 4. Verifying against the spec

A change is done when:

1. `./bin/check` and `./bin/test` pass; `./bin/test-e2e` passes for anything that touches what the
   operator sees or the startup sequence.
2. Its behaviour matches the governing spec file, highest precedence first (see
   [AGENTS.md](../AGENTS.md)). Where the change intentionally departs from the spec, the spec is
   updated in the same change — with a [decision record](decisions/) when it alters an earlier
   decision.
3. Invariants in [domain.md §5](domain.md#5-invariants) still hold. Prefer a test that would fail if
   one broke.
4. A UI change is checked against [ui-ux.md §10](ui-ux.md#10-anti-patterns) in both themes
   (samaritan and machine) and under reduced motion.
5. An operator-visible change has a draft line under `## Unreleased` in `CHANGELOG.md`
   ([architecture.md §8.4](architecture.md#84-changelog)); `changelog.spec.ts` and the web
   changelog tests guard the file's format.
6. A change under `loop/` or `providers/` passes `loop/bin/check`.

## 5. When to run what

| Moment | Run |
|---|---|
| While editing | the affected workspace's tests (`./bin/sh` then `npm test --workspace <pkg>`) |
| Before proposing a change | `./bin/check`, `./bin/test` |
| UI, wizard, console or provider-flow changes | add `./bin/test-e2e` |
| `loop/` or `providers/` changes | `loop/bin/check` |
| Release preparation | all of the above, then [architecture.md §8.3](architecture.md#83-release-checklist) |
