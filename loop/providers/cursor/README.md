# Cursor provider

Self-contained bundle for the Cursor Agent CLI (`agent`). Implements the
same built steps as `claude-code`: structure, research, scope, plan, and
pick-plan.

## Layout

```
loop/providers/cursor/
  manifest              # PROVIDER_ID, PROVIDER_CLI=agent, PROVIDER_CONFIG_DIR, …
  provider.sh           # provider contract (see below)
  .cursor/
    cli.json            # project permissions (deny Shell; allow Read/Write/WebFetch)
    commands/
      structure-request.md
      research-request.md
      scope-request.md
      plan-request.md
      pick-plan-request.md
```

`PROVIDER_CONFIG_DIR=.cursor` keeps project discovery rooted at this
bundle, never at `loop/` or another provider.

## Provider contract

`provider.sh` defines:

| Function | Called by | Must write |
|---|---|---|
| `provider_check_available` | `load_provider` | — |
| `provider_structure` | `step_request` | `requests/<id>.md` |
| `provider_research` | `step_research` | `research/<id>.md`, `memory.md` |
| `provider_scope` | `step_scope` | `scope/<id>.md` (+ in-session `plan/<id>.md`) |
| `provider_plan` | `step_plan` | `plan/<id>.md` |
| `provider_pick_plan` | `loop/run` pick-and-plan | pick result + `plan/<id>.md` in one session |

## How invocations work

- CLI binary: `agent` (on PATH; authenticated via `agent login` or
  `CURSOR_API_KEY`).
- cwd / `--workspace` is always `$PROVIDER_ROOT`.
- Prompts are composed from the matching `.cursor/commands/*.md` body plus
  a **named** Concrete arguments block (`planned_at = …`, not `$10 = …`).
  Multi-digit `$N` bindings are avoided — models misread `$10` as `$1`+`0`.
  Slash-command + trailing args are avoided (the agent CLI has dropped that
  trailing text).
- Interactive when a TTY is attached (`structure`, always for `scope` /
  pick-and-plan); headless `agent -p --force --trust --output-format json`
  otherwise (`structure` without TTY, always for `research` / `plan`).
  Pick-and-plan is one session: analyze → ask → write plan, then the human
  exits so bash can record the plan event.
- Research and plan pass `--add-dir` for the project workspace.
- Step scripts never see Cursor-specific flags — only the contract
  functions.

## Constraints

- Bash orchestration only: no Node/Python helpers under `loop/` for the
  provider invoke path (`agent` on PATH is fine).
- Run `loop/bin/check-providers` after changes — it fails if Claude-specific
  paths or CLIs leak into orchestration or into this bundle.
