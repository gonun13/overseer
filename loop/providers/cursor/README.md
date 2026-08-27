# Cursor provider (stub)

This bundle defines the layout a future Cursor implementation must ship.
It is **not** implemented: selecting `LOOP_PROVIDER=cursor` fails at
provider load with a clear message.

## Required layout

```
loop/providers/cursor/
  manifest              # PROVIDER_ID, PROVIDER_CLI, PROVIDER_CONFIG_DIR, …
  provider.sh           # four-function contract (see below)
  .cursor/commands/     # Cursor-native command files for each step
    structure-request.*
    research-request.*
    scope-request.*
```

`PROVIDER_CONFIG_DIR=.cursor` is a placeholder convention so
`--setting-sources`-equivalent discovery (whatever Cursor uses for project
commands) stays rooted at this bundle, never at `loop/`.

## Provider contract

`provider.sh` must define:

| Function | Called by | Must write |
|---|---|---|
| `provider_check_available` | `load_provider` | — |
| `provider_structure` | `step_request` | `requests/<id>.md` |
| `provider_research` | `step_research` | `research/<id>.md`, `memory.md` |
| `provider_scope` | `step_scope` | `scope/<id>.md` |

Step scripts call only these functions. Command names, CLI flags, and
config paths stay inside this bundle.

## Constraints

- Bash orchestration only: no Node/Python helpers under `loop/` for the
  provider invoke path (CLI on PATH is fine).
- Invocations must `cd` to `PROVIDER_ROOT` (this directory) so project
  config discovery cannot pick up `providers/claude-code/.claude/` or
  anything at the loop root.
- Run `loop/bin/check-providers` after changes — it fails if Claude-specific
  paths or CLIs leak into orchestration or into this bundle.
