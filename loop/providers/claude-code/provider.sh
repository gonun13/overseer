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
# The grant covers the widest thing that runs in this session, which is the
# `implement` step: it edits the project in place and runs the project's own
# test command, so Edit and an unprefixed Bash are both required. A subagent
# inherits what the session holds, so there is no narrower way to give an
# implement subagent tools the overseer does not have.
#
# What still bounds it: the deny list below, one human watching the whole
# session, and overseer.md's standing rule that only an `implement` subagent
# may change a file under the workspace. The overseer itself never writes code.
provider_session() {
  local prompt=$1 workspace_dir=$2 status=0

  (cd "$PROVIDER_ROOT" && claude "$prompt" \
    --add-dir "$LOOP_DIR" \
    --add-dir "$workspace_dir" \
    --allowedTools "Read,Write,Edit,Glob,Grep,Task,AskUserQuestion,WebFetch,WebSearch,Bash" \
    --disallowedTools "NotebookEdit" \
    --permission-mode acceptEdits \
    --setting-sources project) || status=$?

  if [ "$status" -ne 0 ]; then
    echo "claude CLI exited non-zero ($status)" >&2
    return 1
  fi
  return 0
}
