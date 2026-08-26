#!/usr/bin/env bash
# The claude-code provider — the only real implementation for now.
# Implements the provider contract from lib/providers.sh.

provider_check_available() {
  require_cmd claude
}

# provider_structure <raw_file> <record_file> <id> <workspace> <slug> <submitted_at> <raw_ref>
# Runs the /structure-request slash command, scoped to loop/ so
# .claude/commands/ is discovered. Everything CLI-specific to claude-code
# lives in this function only — loop/request never sees it.
#
# Interactive when there's a terminal to attach to (the normal case): runs
# `claude` as a real foreground session, inheriting stdio, so the human
# watches the Read/Write happen live instead of it all happening behind a
# hidden one-shot call. Falls back to a headless `claude -p` call only when
# there's no terminal to attach to — a scripted `--file`/piped-stdin
# invocation, where nobody is there to watch anyway and a one-shot call
# keeps things scriptable/testable.
#
# Either way, the caller (loop/request) never trusts this function's exit
# status alone — record_is_valid() independently checks the file it wrote.
provider_structure() {
  local raw_file=$1 record_file=$2 id=$3 workspace=$4 slug=$5 submitted_at=$6 raw_ref=$7
  local prompt="/structure-request $raw_file $record_file $id $workspace $slug $submitted_at $raw_ref"

  if [ -t 0 ] && [ -t 1 ]; then
    (cd "$LOOP_DIR" && claude "$prompt" \
      --allowedTools "Read Write" \
      --disallowedTools "Bash Edit Glob Grep Task WebFetch WebSearch" \
      --permission-mode acceptEdits \
      --setting-sources project)
    local status=$?
    if [ "$status" -ne 0 ]; then
      echo "claude CLI exited non-zero ($status)" >&2
      return 1
    fi
    return 0
  fi

  local result_json
  result_json=$(cd "$LOOP_DIR" && claude -p \
    "$prompt" \
    --allowedTools "Read Write" \
    --disallowedTools "Bash Edit Glob Grep Task WebFetch WebSearch" \
    --permission-mode acceptEdits \
    --setting-sources project \
    --output-format json \
    --no-session-persistence \
    < /dev/null) || { echo "claude CLI exited non-zero" >&2; return 1; }

  local is_error subtype
  is_error=$(printf '%s' "$result_json" | jq -r '.is_error // false')
  subtype=$(printf '%s' "$result_json" | jq -r '.subtype // "unknown"')

  if [ "$is_error" != "false" ] || [ "$subtype" != "success" ]; then
    printf 'structuring failed: %s\n' "$(printf '%s' "$result_json" | jq -r '.result // "unknown error"')" >&2
    return 1
  fi

  return 0
}
