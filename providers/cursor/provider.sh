#!/usr/bin/env bash
# The cursor provider — the Cursor Agent CLI (`agent`). Implements the provider
# contract from bin/lib/providers.sh: check that the CLI is there, and open an
# interactive session on it. Everything CLI-specific to cursor lives in this
# file — orchestration and the step instructions never see a flag or a binary
# name.
#
# Config discovery follows the process's cwd, not --workspace, so cwd stays on
# this bundle and its .cursor/ is the only config the session sees — never
# loop/ root, never the repo's own, never another provider's. (--workspace only
# *defaults* to cwd; setting it moves the agent's workspace and nothing else.
# Verified by pointing the two at different directories, each with a malformed
# config: the CLI reported the cwd one both times.)
#
# The workspace itself is the project, which is what the operator asked for and
# what the `implement` step edits.

provider_check_available() {
  require_cmd agent
  require_cmd jq
}

# provider_session <prompt> <workspace_dir>
# Open a foreground interactive session, inheriting this terminal, and return
# when the human exits it. The prompt is the overseer's kickoff.
#
# --force allows tool calls the config does not explicitly deny: the overseer
# needs a shell to run the loop's own commands, and the `implement` step needs
# to edit the project and run its tests. There is a human watching the whole
# session, and overseer.md's standing rule is that only an `implement` subagent
# may change a file under the workspace. --sandbox disabled is required for an
# interactive session to reach the loop's db/ and the project at all.
provider_session() {
  local prompt=$1 workspace_dir=$2 status=0

  # LOOP_MODEL is loop/run's neutral env var for the overseer's own model —
  # set from loop/models.json (loop/bin/models). Empty means "whatever this
  # CLI opens on by default" (its own `auto`).
  local -a model_args=()
  if [ -n "${LOOP_MODEL:-}" ]; then
    model_args=(--model "$LOOP_MODEL")
  fi

  (cd "$PROVIDER_ROOT" && agent \
    --workspace "$workspace_dir" \
    --add-dir "$LOOP_DIR" \
    --force --trust \
    --sandbox disabled \
    "${model_args[@]}" \
    "$prompt") || status=$?

  if [ "$status" -ne 0 ]; then
    echo "agent CLI exited non-zero ($status)" >&2
    return 1
  fi
  return 0
}

# provider_list_models — this account's models, as `agent models` prints
# them, as JSON on stdout: `{"models":[{"value","label"}...],"defaultModel"}`.
#
# `agent models` plain-text output, verified against 2026.08.31-4057e58:
#
#   Available models
#
#   auto - Auto (current, default)
#   gpt-5.3-codex-low - Codex 5.3 Low
#   ...
#
# The row a turn with no `--model` would run on carries a marker with two
# verified forms: `(current, default)` on an untouched account, or `(current)`
# alone once the account's selection has moved off that default (switching
# models for one turn persists as the new selection) — both mean the same
# thing for `defaultModel`, so both are read. Mirrors
# packages/adapters/cursor/src/options.ts's `parseModelsOutput` exactly; keep
# the two in step.
provider_list_models() {
  local line value rest label models='[]' default_model=''
  while IFS= read -r line; do
    line=$(printf '%s' "$line" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')
    [ -n "$line" ] || continue
    [[ "$line" =~ ^([^[:space:]]+)[[:space:]]+-[[:space:]]+(.+)$ ]] || continue
    value="${BASH_REMATCH[1]}"
    rest="${BASH_REMATCH[2]}"
    if [[ "$rest" == *"(current, default)"* || "$rest" == *"(current)"* ]]; then
      default_model="$value"
    fi
    label=$(printf '%s' "$rest" | sed -E 's/[[:space:]]*\(current(, default)?\)[[:space:]]*//')
    [ -n "$label" ] || label="$value"
    models=$(jq -c --argjson acc "$models" --arg v "$value" --arg l "$label" \
      -n '$acc + [{value:$v, label:$l}]')
  done < <(agent models 2>/dev/null)

  jq -n --argjson models "$models" --arg d "$default_model" \
    '{models:$models, defaultModel:(if $d == "" then null else $d end)}'
}
