# Cursor provider

Self-contained bundle for the Cursor Agent CLI (`agent`). Implements the
same three built steps as `claude-code`: structure, research, and scope.

## Layout

```
loop/providers/cursor/
  manifest              # PROVIDER_ID, PROVIDER_CLI=agent, PROVIDER_CONFIG_DIR, …
  provider.sh           # four-function contract (see below)
  .cursor/
    cli.json            # project permissions (deny Shell; allow Read/Write/WebFetch)
    commands/
      structure-request.md
      research-request.md
      scope-request.md
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
| `provider_scope` | `step_scope` | `scope/<id>.md` |

## How invocations work

- CLI binary: `agent` (on PATH; authenticated via `agent login` or
  `CURSOR_API_KEY`).
- cwd / `--workspace` is always `$PROVIDER_ROOT`.
- Prompts are composed from the matching `.cursor/commands/*.md` body plus
  an explicit `$1`…`$N` argument binding block. Slash-command + trailing
  args are avoided (the agent CLI has dropped that trailing text).
- Interactive when a TTY is attached (`structure`, always for `scope`);
  headless `agent -p --force --trust --output-format json` otherwise
  (`structure` without TTY, always for `research`).
- Research passes `--add-dir` for the project workspace.
- Step scripts never see Cursor-specific flags — only the four contract
  functions.

## Constraints

- Bash orchestration only: no Node/Python helpers under `loop/` for the
  provider invoke path (`agent` on PATH is fine).
- Run `loop/bin/check-providers` after changes — it fails if Claude-specific
  paths or CLIs leak into orchestration or into this bundle.
