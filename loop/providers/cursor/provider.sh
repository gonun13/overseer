#!/usr/bin/env bash
# The cursor provider — the Cursor Agent CLI (`agent`). Implements the provider
# contract from bin/lib/providers.sh: check that the CLI is there, and open an
# interactive session on it. Everything CLI-specific to cursor lives in this
# file — orchestration and the step instructions never see a flag or a binary
# name.
#
# --workspace pins config discovery to this bundle's .cursor/ — never loop/
# root, never the repo's own config, never another provider's tree.

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

  (cd "$PROVIDER_ROOT" && agent \
    --workspace "$PROVIDER_ROOT" \
    --add-dir "$LOOP_DIR" \
    --add-dir "$workspace_dir" \
    --force --trust \
    --sandbox disabled \
    "$prompt") || status=$?

  if [ "$status" -ne 0 ]; then
    echo "agent CLI exited non-zero ($status)" >&2
    return 1
  fi
  return 0
}
