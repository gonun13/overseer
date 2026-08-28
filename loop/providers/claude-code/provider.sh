#!/usr/bin/env bash
# The claude-code provider. Implements the provider contract from
# bin/lib/providers.sh: check that the CLI is there, and open an interactive
# session on it. Everything CLI-specific to claude-code lives in this file —
# orchestration and the step instructions never see a flag or a binary name.
#
# The session runs with cwd $PROVIDER_ROOT so --setting-sources project
# discovers only this bundle's .claude/ — never loop/ root, never the repo's
# own .claude/, never another provider's tree.

provider_check_available() {
  require_cmd claude
}

# provider_session <prompt> <workspace_dir>
# Open a foreground interactive session, inheriting this terminal, and return
# when the human exits it. The prompt is the overseer's kickoff.
#
# The grant is wider than the old per-step calls needed, because the overseer
# is a different kind of thing: it runs the loop's own commands (Bash, limited
# by prefix to loop/bin), delegates steps (Task), and talks to the human
# (AskUserQuestion) — all in front of a human who is watching it work.
#
# Edit stays denied. Every built step writes whole artifacts with Write; none
# of them modifies a file in place, and none of them may touch the project.
provider_session() {
  local prompt=$1 workspace_dir=$2 status=0

  (cd "$PROVIDER_ROOT" && claude "$prompt" \
    --add-dir "$LOOP_DIR" \
    --add-dir "$workspace_dir" \
    --allowedTools "Read,Write,Glob,Grep,Task,AskUserQuestion,WebFetch,WebSearch,Bash($LOOP_DIR/bin/*)" \
    --disallowedTools "Edit,NotebookEdit" \
    --permission-mode acceptEdits \
    --setting-sources project) || status=$?

  if [ "$status" -ne 0 ]; then
    echo "claude CLI exited non-zero ($status)" >&2
    return 1
  fi
  return 0
}
