#!/usr/bin/env bash
# The claude-code provider. Implements the provider contract from
# bin/lib/providers.sh: check that the CLI is there, and open an interactive
# session on it. Everything CLI-specific to claude-code lives in this file —
# orchestration and the step instructions never see a flag or a binary name.
#
# The session's cwd is the workspace project: the directory the operator asked
# for, and the one the `implement` step edits. Config does not come from there,
# or from anywhere else on disk — --settings names this bundle's file and
# --setting-sources "" switches discovery off entirely, so no ancestor .claude/
# can reach the session. That is a stronger guarantee than pinning cwd to the
# bundle and trusting discovery to land on it, which is what this used to do:
# the repo root is a git root carrying its own config, one level above the
# bundle, and nothing asserted that the CLI would prefer the nearer one.

provider_check_available() {
  require_cmd claude
}

# provider_interactive_ready <dir> — mark interactive onboarding complete and
# trust <dir>, so the session opens in the REPL rather than behind a theme
# picker, a second browser login, and a trust dialog.
#
# Delegates to the app's own implementation instead of restating its policy in
# bash. That module is what the raw OPEN CONSOLE path already calls, for exactly
# this, and it carries the tests; it writes two booleans into the CLI's config
# JSON and never reads or logs a credential field.
#
# Trusting the directory on the operator's behalf is deliberate, and not new:
# the app does the same for every console it opens on a workspace project. What
# the session may actually do is bounded by the settings file named below and by
# the human watching it — never by that dialog, which only ever described a
# directory chosen for the CLI's benefit rather than the operator's.
provider_interactive_ready() {
  local dir=$1
  local mod="$REPO_ROOT/packages/adapters/claude-code/dist/interactive-ready.js"

  if [ ! -f "$mod" ]; then
    log_info "could not pre-set onboarding state ($mod is missing) — the CLI may ask you to trust '$dir'"
    return 0
  fi

  # `node -e` argv is [execPath, ...args]: $1 is the module, $2 the directory.
  # A failure here costs a dialog, not the session, so it warns and returns.
  node -e 'import(process.argv[1])
             .then((m) => m.ensureInteractiveReady(process.argv[2]))
             .catch((e) => {
               console.error("loop: could not pre-set onboarding state:", e.message);
             });' "$mod" "$dir"
}

# provider_session <prompt> <workspace_dir>
# Open a foreground interactive session, inheriting this terminal, and return
# when the human exits it. The prompt is the overseer's kickoff.
#
# The grant covers the widest thing that runs in this session, which is the
# `implement` step: it edits the project in place and runs the project's own
# test command, so Edit and an unprefixed Bash are both required. A subagent
# inherits what the session holds, so there is no narrower way to give an
# implement subagent tools the overseer does not have.
#
# What still bounds it: the deny list in this bundle's settings, one human
# watching the whole session, and overseer.md's standing rule that only an
# `implement` subagent may change a file under the workspace. The overseer
# itself never writes code.
provider_session() {
  local prompt=$1 workspace_dir=$2 status=0

  provider_interactive_ready "$workspace_dir"

  # --add-dir covers the loop itself; the project needs none, being the cwd.
  (cd "$workspace_dir" && claude "$prompt" \
    --add-dir "$LOOP_DIR" \
    --settings "$PROVIDER_CONFIG_ROOT/settings.json" \
    --setting-sources "" \
    --allowedTools "Read,Write,Edit,Glob,Grep,Task,AskUserQuestion,WebFetch,WebSearch,Bash" \
    --disallowedTools "NotebookEdit" \
    --permission-mode acceptEdits) || status=$?

  if [ "$status" -ne 0 ]; then
    echo "claude CLI exited non-zero ($status)" >&2
    return 1
  fi
  return 0
}
