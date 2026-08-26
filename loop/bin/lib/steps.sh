#!/usr/bin/env bash
# Per-step teardown ("safe dismount") dispatch, used by loop/clear before it
# deletes a request's files. Requires common.sh to already be sourced
# (LOOP_DIR, log_info). Mirrors the shape of lib/providers.sh: an id (here,
# the step name) plus one function a step may optionally implement.

# step_teardown <slug> <id> <step> — best-effort cleanup for whatever a step
# may have left mounted, locked, or running (a workspace bind-mount, a
# tracked subagent PID, a git worktree, …) before its request is deleted.
# No-op when lib/steps/<step>.sh doesn't exist or defines no hook — most
# steps (anything read-only or already synchronous/one-shot) have nothing
# to release.
step_teardown() {
  local slug=$1 id=$2 step=$3
  local hook="$LOOP_BIN_DIR/lib/steps/${step}.sh"

  if [ -f "$hook" ]; then
    # shellcheck disable=SC1090
    source "$hook"
    if declare -F step_teardown_hook >/dev/null; then
      step_teardown_hook "$slug" "$id"
      return
    fi
  fi

  log_info "no teardown needed for step '$step'"
}
