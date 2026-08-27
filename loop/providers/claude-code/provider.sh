#!/usr/bin/env bash
# The claude-code provider — the only real implementation for now.
# Implements the provider contract from bin/lib/providers.sh.
# Invocations use cwd $PROVIDER_ROOT so --setting-sources project discovers
# only this bundle's .claude/ (never loop/ root or another provider).

provider_check_available() {
  require_cmd claude
}

# provider_structure <raw_file> <record_file> <id> <workspace> <slug> <submitted_at> <raw_ref>
# Runs the /structure-request slash command under this bundle's config root.
# Everything CLI-specific to claude-code lives in this function only —
# step scripts never see it.
#
# Interactive when there's a terminal to attach to (the normal case): runs
# `claude` as a real foreground session, inheriting stdio, so the human
# watches the Read/Write happen live instead of it all happening behind a
# hidden one-shot call. Falls back to a headless `claude -p` call only when
# there's no terminal to attach to — a scripted `--file`/piped-stdin
# invocation, where nobody is there to watch anyway and a one-shot call
# keeps things scriptable/testable.
#
# Either way, the caller never trusts this function's exit status alone —
# record_is_valid() independently checks the file it wrote.
provider_structure() {
  local raw_file=$1 record_file=$2 id=$3 workspace=$4 slug=$5 submitted_at=$6 raw_ref=$7
  local prompt="/structure-request $raw_file $record_file $id $workspace $slug $submitted_at $raw_ref"

  if [ -t 0 ] && [ -t 1 ]; then
    (cd "$PROVIDER_ROOT" && claude "$prompt" \
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
  result_json=$(cd "$PROVIDER_ROOT" && claude -p \
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

# provider_research <record_file> <workspace_dir> <memory_file> <research_file>
#   <id> <workspace> <slug> <researched_at> <request_ref>
# Runs the /research-request slash command under this bundle's config root.
# --add-dir grants read access into the actual project so Read/Grep/Glob
# can explore it. Always headless: research is an automated LLM step only,
# no human watches it (unlike provider_structure's interactive branch).
#
# The caller never trusts this function's exit status alone —
# research_is_valid() independently checks the file it wrote.
provider_research() {
  local record_file=$1 workspace_dir=$2 memory_file=$3 research_file=$4
  local id=$5 workspace=$6 slug=$7 researched_at=$8 request_ref=$9
  local prompt="/research-request $record_file $workspace_dir $memory_file $research_file $id $workspace $slug $researched_at $request_ref"

  local result_json
  result_json=$(cd "$PROVIDER_ROOT" && claude -p \
    "$prompt" \
    --add-dir "$workspace_dir" \
    --allowedTools "Read Grep Glob Write WebFetch WebSearch" \
    --disallowedTools "Bash Edit Task" \
    --permission-mode acceptEdits \
    --setting-sources project \
    --output-format json \
    --no-session-persistence \
    < /dev/null) || { echo "claude CLI exited non-zero" >&2; return 1; }

  local is_error subtype
  is_error=$(printf '%s' "$result_json" | jq -r '.is_error // false')
  subtype=$(printf '%s' "$result_json" | jq -r '.subtype // "unknown"')

  if [ "$is_error" != "false" ] || [ "$subtype" != "success" ]; then
    printf 'research failed: %s\n' "$(printf '%s' "$result_json" | jq -r '.result // "unknown error"')" >&2
    return 1
  fi

  return 0
}

# provider_scope <record_file> <research_file> <decision_file> <id> <workspace>
#   <slug> <scoped_at> <request_ref> <research_ref> <plan_file> <planned_at>
#   <scope_ref> <workspace_dir> <memory_file>
# Runs the /scope-request slash command under this bundle's config root.
# Always interactive, foreground, inheriting stdio — unlike
# provider_structure, there is no headless fallback branch: grilling the
# human *is* the step, so a scripted/piped invocation makes no sense here.
# loop/run checks for a TTY and refuses to even load the provider without
# one, so this function can assume it always has one.
#
# After writing the scope decision, the same session continues into the plan
# step (writes plan_file) when the human is ready — Grep/Glob are allowed
# for that planning half only as light clarification, not a second research
# pass. WebFetch/WebSearch stay allowed for live design facts mid-scope.
#
# The caller never trusts this function's exit status alone —
# scope_is_valid() / plan_is_present_valid() independently check the files.
provider_scope() {
  local record_file=$1 research_file=$2 decision_file=$3 id=$4 workspace=$5
  local slug=$6 scoped_at=$7 request_ref=$8 research_ref=$9
  local plan_file=$10 planned_at=$11 scope_ref=$12 workspace_dir=$13 memory_file=$14
  local prompt="/scope-request $record_file $research_file $decision_file $id $workspace $slug $scoped_at $request_ref $research_ref $plan_file $planned_at $scope_ref $workspace_dir $memory_file"

  (cd "$PROVIDER_ROOT" && claude "$prompt" \
    --add-dir "$workspace_dir" \
    --allowedTools "Read Write AskUserQuestion WebFetch WebSearch Grep Glob" \
    --disallowedTools "Bash Edit Task" \
    --permission-mode acceptEdits \
    --setting-sources project)
  local status=$?
  if [ "$status" -ne 0 ]; then
    echo "claude CLI exited non-zero ($status)" >&2
    return 1
  fi
  return 0
}

# provider_plan <record_file> <research_file> <scope_file> <memory_file>
#   <workspace_dir> <plan_file> <id> <workspace> <slug> <planned_at>
#   <request_ref> <research_ref> <scope_ref>
# Headless one-shot plan. Caller validates with plan_is_valid.
provider_plan() {
  local record_file=$1 research_file=$2 scope_file=$3 memory_file=$4
  local workspace_dir=$5 plan_file=$6 id=$7 workspace=$8 slug=$9
  local planned_at=$10 request_ref=$11 research_ref=$12 scope_ref=$13
  local prompt="/plan-request $record_file $research_file $scope_file $memory_file $workspace_dir $plan_file $id $workspace $slug $planned_at $request_ref $research_ref $scope_ref"

  local result_json
  result_json=$(cd "$PROVIDER_ROOT" && claude -p \
    "$prompt" \
    --add-dir "$workspace_dir" \
    --allowedTools "Read Grep Glob Write" \
    --disallowedTools "Bash Edit Task WebFetch WebSearch" \
    --permission-mode acceptEdits \
    --setting-sources project \
    --output-format json \
    --no-session-persistence \
    < /dev/null) || { echo "claude CLI exited non-zero" >&2; return 1; }

  local is_error subtype
  is_error=$(printf '%s' "$result_json" | jq -r '.is_error // false')
  subtype=$(printf '%s' "$result_json" | jq -r '.subtype // "unknown"')

  if [ "$is_error" != "false" ] || [ "$subtype" != "success" ]; then
    printf 'planning failed: %s\n' "$(printf '%s' "$result_json" | jq -r '.result // "unknown error"')" >&2
    return 1
  fi

  return 0
}

# provider_pick_plan <bundle_file> <result_file> <workspace_dir>
# Interactive: analyze scoped candidates, AskUserQuestion, write pick result
# and the chosen request's plan in the same session. Caller validates the plan.
provider_pick_plan() {
  local bundle_file=$1 result_file=$2 workspace_dir=$3
  local prompt="/pick-plan-request $bundle_file $result_file $workspace_dir"

  (cd "$PROVIDER_ROOT" && claude "$prompt" \
    --add-dir "$workspace_dir" \
    --allowedTools "Read Write AskUserQuestion Grep Glob" \
    --disallowedTools "Bash Edit Task WebFetch WebSearch" \
    --permission-mode acceptEdits \
    --setting-sources project)
  local status=$?
  if [ "$status" -ne 0 ]; then
    echo "claude CLI exited non-zero ($status)" >&2
    return 1
  fi
  return 0
}
