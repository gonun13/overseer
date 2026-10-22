#!/usr/bin/env bash
# The opencode provider. Implements the provider contract from
# bin/lib/providers.sh: check that the CLI is there, and open an interactive
# session on it. Everything CLI-specific to opencode lives in this file —
# orchestration and the step instructions never see a flag or a binary name.
#
# The session's cwd is the workspace project. Config comes from this bundle
# alone, by three switches verified against opencode 1.19.4 with
# `opencode debug config`:
#
#   XDG_CONFIG_HOME                   the CLI's global config dir becomes this
#                                     bundle's, so the operator's own is unread
#   OPENCODE_DISABLE_PROJECT_CONFIG   no opencode.json or .opencode/ from the
#                                     project or any ancestor
#   OPENCODE_DISABLE_CLAUDE_CODE      no CLAUDE.md or skills from another
#                                     provider's config tree
#
# The CLI installs its plugin runtime into whatever config dir it reads, so the
# bundle's file is copied into a writable directory on the agent-home volume
# rather than read in place: the repo is never written, and the install is
# kept between runs. Auth and sessions stay where the app keeps them, so the
# loop runs on whatever providers are connected there.

provider_check_available() {
  require_cmd opencode
  require_cmd node
}

# The app's own adapter, built: session creation and the plugin that delivers
# the kickoff prompt are its code, with its tests, not restated here.
opencode_adapter_dist() {
  printf '%s/packages/adapters/opencode/dist' "$REPO_ROOT"
}

# provider_mint_session <workspace_dir> — create the session this run opens
# under and print its id. opencode cannot be told to adopt an id, so loop/run
# asks the bundle for one instead of minting it. Prints nothing and fails when
# it cannot, and the run goes ahead on a session the CLI names itself.
provider_mint_session() {
  local dir=$1 mod
  mod="$(opencode_adapter_dist)/index.js"
  [ -f "$mod" ] || return 1
  # `node -e` argv is [execPath, ...args]: $1 is the module, $2 the directory.
  node -e 'import(process.argv[1])
             .then((m) => m.prepareSession(process.argv[2]))
             .then((id) => process.stdout.write(id))
             .catch((e) => {
               console.error("loop: could not prepare an opencode session:", e.message);
               process.exit(1);
             });' "$mod" "$dir"
}

# provider_discard_session <session_id> <workspace_dir> — remove a session
# provider_mint_session created for a run that then did not start.
provider_discard_session() {
  (cd "$2" && opencode session delete "$1" >/dev/null 2>&1) || true
}

# provider_session <prompt> <workspace_dir>
# Open a foreground interactive session, inheriting this terminal, and return
# when the human exits it. The prompt is the overseer's kickoff.
#
# The grant covers the widest thing that runs in this session, which is the
# `implement` step: edits and an unprefixed shell, with the deny list in this
# bundle's opencode.json and outside directories allowed so the loop's own
# commands and db/ are reachable. A subagent inherits what the session holds.
# What still bounds it: that deny list, one human watching the whole session,
# and overseer.md's standing rule that only an `implement` subagent may change
# a file under the workspace.
provider_session() {
  local prompt=$1 workspace_dir=$2 status=0 config_home dist
  config_home="$HOME/.cache/overseer/loop-opencode"
  dist=$(opencode_adapter_dist)

  mkdir -p "$config_home/opencode"
  cp "$PROVIDER_CONFIG_ROOT/opencode.json" "$config_home/opencode/opencode.json"

  # LOOP_MODEL is loop/run's neutral env var for the overseer's own model, as
  # `provider/model`. Empty means whatever this CLI opens on by default.
  local -a model_args=()
  if [ -n "${LOOP_MODEL:-}" ]; then
    model_args=(--model "$LOOP_MODEL")
  fi

  # With a prepared session, `--prompt` is ignored beside `--session`, so the
  # adapter's plugin sends the kickoff into it once the TUI is up. Without one
  # (no build, or preparation failed) the CLI starts and names its own session.
  local -a session_args=() plugin_env=()
  if [ -n "${LOOP_SESSION_ID:-}" ] && [ -f "$dist/plugin.js" ]; then
    session_args=(--session "$LOOP_SESSION_ID")
    plugin_env=(
      "OPENCODE_CONFIG_CONTENT={\"plugin\":[\"file://$dist/plugin.js\"]}"
      "OVERSEER_OPENCODE_SESSION=$LOOP_SESSION_ID"
      "OVERSEER_OPENCODE_PROMPT=$prompt"
    )
  else
    session_args=(--prompt "$prompt")
  fi

  (cd "$workspace_dir" && env \
    XDG_CONFIG_HOME="$config_home" \
    OPENCODE_DISABLE_PROJECT_CONFIG=1 \
    OPENCODE_DISABLE_CLAUDE_CODE=1 \
    OPENCODE_DISABLE_AUTOUPDATE=1 \
    "${plugin_env[@]}" \
    opencode "${session_args[@]}" "${model_args[@]}") || status=$?

  if [ "$status" -ne 0 ]; then
    echo "opencode CLI exited non-zero ($status)" >&2
    return 1
  fi
  return 0
}

# provider_list_models — the models of every provider connected right now, as
# `opencode models` prints them (one `provider/model` per line), as JSON on
# stdout: `{"models":[{"value","label"}...],"defaultModel"}`. The CLI marks no
# default in that list, so defaultModel is null and the session opens on the
# CLI's own choice.
provider_list_models() {
  OPENCODE_DISABLE_AUTOUPDATE=1 opencode models 2>/dev/null \
    | grep -E '^[A-Za-z0-9._-]+/[^[:space:]]+$' \
    | jq -R -s '{
        models: [split("\n")[] | select(. != "") | {value: ., label: .}],
        defaultModel: null
      }'
}
