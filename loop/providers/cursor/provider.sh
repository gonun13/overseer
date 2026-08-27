#!/usr/bin/env bash
# The cursor provider — Cursor Agent CLI (`agent`) implementing the same
# built steps as claude-code (structure, research, scope, plan, pick-plan).
# Invocations use cwd $PROVIDER_ROOT so project discovery sees only this
# bundle's .cursor/ (never loop/ root or another provider).
#
# Prompts are composed from .cursor/commands/*.md plus an explicit argument
# binding block — not slash-command + trailing args — because the agent CLI
# has historically dropped text after custom slash commands.

provider_check_available() {
  require_cmd agent
  require_cmd jq
}

# _cursor_command_body <command-stem>
# Prints the markdown body of .cursor/commands/<stem>.md with YAML
# frontmatter stripped (if present).
_cursor_command_body() {
  local stem=$1
  local file="$PROVIDER_ROOT/$PROVIDER_COMMANDS_DIR/${stem}.md"
  [ -f "$file" ] || { echo "cursor provider missing command file: $file" >&2; return 1; }

  # Strip a leading --- … --- frontmatter block when present.
  awk '
    BEGIN { in_fm=0; done_fm=0 }
    NR==1 && $0=="---" { in_fm=1; next }
    in_fm && $0=="---" { in_fm=0; done_fm=1; next }
    in_fm { next }
    { print }
  ' "$file"
}

# _cursor_prompt <command-stem> <name1> <val1> <name2> <val2> …
# Command body + named Concrete arguments block. Names (not $10-style
# positionals) are the binding the model must copy — LLMs routinely misread
# $10 as $1+"0", which corrupts frontmatter.
_cursor_prompt() {
  local stem=$1
  shift
  local body
  body=$(_cursor_command_body "$stem") || return 1

  printf '%s\n\n' "$body"
  printf 'Concrete arguments — copy each VALUE by NAME into paths/frontmatter.\n'
  printf 'Do not invent paths. Do not treat multi-digit $N as $1 plus a digit.\n\n'
  local name val
  while [ $# -ge 2 ]; do
    name=$1
    val=$2
    shift 2
    printf '%s = %s\n' "$name" "$val"
  done
}

# _cursor_json_ok <json> <label>
# True when agent -p --output-format json reported success.
_cursor_json_ok() {
  local result_json=$1 label=$2
  local is_error subtype
  is_error=$(printf '%s' "$result_json" | jq -r '.is_error // false')
  subtype=$(printf '%s' "$result_json" | jq -r '.subtype // "unknown"')

  if [ "$is_error" != "false" ] || [ "$subtype" != "success" ]; then
    printf '%s failed: %s\n' "$label" "$(printf '%s' "$result_json" | jq -r '.result // "unknown error"')" >&2
    return 1
  fi
  return 0
}

# provider_structure <raw_file> <record_file> <id> <workspace> <slug> <submitted_at> <raw_ref>
# Interactive when a TTY is attached; otherwise headless print mode.
# Caller still validates via record_is_valid().
provider_structure() {
  local raw_file=$1 record_file=$2 id=$3 workspace=$4 slug=$5 submitted_at=$6 raw_ref=$7
  local prompt
  prompt=$(_cursor_prompt structure-request \
    raw_file "$raw_file" \
    record_file "$record_file" \
    id "$id" \
    workspace "$workspace" \
    slug "$slug" \
    submitted_at "$submitted_at" \
    raw_ref "$raw_ref") || return 1

  if [ -t 0 ] && [ -t 1 ]; then
    (cd "$PROVIDER_ROOT" && agent --workspace "$PROVIDER_ROOT" --force --trust "$prompt")
    local status=$?
    if [ "$status" -ne 0 ]; then
      echo "agent CLI exited non-zero ($status)" >&2
      return 1
    fi
    return 0
  fi

  local result_json
  result_json=$(cd "$PROVIDER_ROOT" && agent -p --force --trust \
    --workspace "$PROVIDER_ROOT" \
    --output-format json \
    "$prompt" \
    < /dev/null) || { echo "agent CLI exited non-zero" >&2; return 1; }

  _cursor_json_ok "$result_json" "structuring"
}

# provider_research <record_file> <workspace_dir> <memory_file> <research_file>
#   <id> <workspace> <slug> <researched_at> <request_ref>
# Always headless. --add-dir grants read access into the project workspace.
# Caller still validates via research_is_valid().
provider_research() {
  local record_file=$1 workspace_dir=$2 memory_file=$3 research_file=$4
  local id=$5 workspace=$6 slug=$7 researched_at=$8 request_ref=$9
  local prompt
  prompt=$(_cursor_prompt research-request \
    record_file "$record_file" \
    workspace_dir "$workspace_dir" \
    memory_file "$memory_file" \
    research_file "$research_file" \
    id "$id" \
    workspace "$workspace" \
    slug "$slug" \
    researched_at "$researched_at" \
    request_ref "$request_ref") || return 1

  local result_json
  result_json=$(cd "$PROVIDER_ROOT" && agent -p --force --trust \
    --workspace "$PROVIDER_ROOT" \
    --add-dir "$workspace_dir" \
    --output-format json \
    "$prompt" \
    < /dev/null) || { echo "agent CLI exited non-zero" >&2; return 1; }

  _cursor_json_ok "$result_json" "research"
}

# provider_scope <record_file> <research_file> <decision_file> <id> <workspace>
#   <slug> <scoped_at> <request_ref> <research_ref> <plan_file> <planned_at>
#   <scope_ref> <workspace_dir> <memory_file>
# Always interactive — grilling the human *is* the step. Continues into plan
# in the same session when the command writes plan_file. No headless path.
# Caller still validates via scope_is_valid() / plan_is_valid().
provider_scope() {
  local record_file=$1 research_file=$2 decision_file=$3 id=$4 workspace=$5
  local slug=$6 scoped_at=$7 request_ref=$8 research_ref=$9
  local plan_file=$10 planned_at=$11 scope_ref=$12 workspace_dir=$13 memory_file=$14
  local prompt
  prompt=$(_cursor_prompt scope-request \
    record_file "$record_file" \
    research_file "$research_file" \
    decision_file "$decision_file" \
    id "$id" \
    workspace "$workspace" \
    slug "$slug" \
    scoped_at "$scoped_at" \
    request_ref "$request_ref" \
    research_ref "$research_ref" \
    plan_file "$plan_file" \
    planned_at "$planned_at" \
    scope_ref "$scope_ref" \
    workspace_dir "$workspace_dir" \
    memory_file "$memory_file") || return 1

  (cd "$PROVIDER_ROOT" && agent --workspace "$PROVIDER_ROOT" --force --trust \
    --add-dir "$workspace_dir" \
    "$prompt")
  local status=$?
  if [ "$status" -ne 0 ]; then
    echo "agent CLI exited non-zero ($status)" >&2
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
  local prompt
  prompt=$(_cursor_prompt plan-request \
    record_file "$record_file" \
    research_file "$research_file" \
    scope_file "$scope_file" \
    memory_file "$memory_file" \
    workspace_dir "$workspace_dir" \
    plan_file "$plan_file" \
    id "$id" \
    workspace "$workspace" \
    slug "$slug" \
    planned_at "$planned_at" \
    request_ref "$request_ref" \
    research_ref "$research_ref" \
    scope_ref "$scope_ref") || return 1

  local result_json
  result_json=$(cd "$PROVIDER_ROOT" && agent -p --force --trust \
    --workspace "$PROVIDER_ROOT" \
    --add-dir "$workspace_dir" \
    --output-format json \
    "$prompt" \
    < /dev/null) || { echo "agent CLI exited non-zero" >&2; return 1; }

  _cursor_json_ok "$result_json" "planning"
}

# provider_pick_plan <bundle_file> <result_file> <workspace_dir>
# Interactive: analyze scoped candidates, ask in plain chat, write pick
# result and the chosen request's plan in the same session.
# Prompt is written to a temp file and kicked off with a short message so a
# huge argv does not stall agent startup (looks like a hang after the list).
provider_pick_plan() {
  local bundle_file=$1 result_file=$2 workspace_dir=$3
  local prompt_file kickoff status=0
  prompt_file=$(mktemp)

  if ! _cursor_prompt pick-plan-request \
      bundle_file "$bundle_file" \
      result_file "$result_file" \
      workspace_dir "$workspace_dir" > "$prompt_file"; then
    rm -f "$prompt_file"
    return 1
  fi

  kickoff="Read the instructions at $prompt_file and follow them exactly. Start by reading bundle_file from those instructions. Ask the human which request to plan in plain chat (no special question tool), then write the pick result and the plan in this same session."

  echo "loop: launching interactive pick-and-plan (agent)…" >&2
  if ! (cd "$PROVIDER_ROOT" && agent --workspace "$PROVIDER_ROOT" --force --trust \
      --sandbox disabled \
      --add-dir "$workspace_dir" \
      "$kickoff"); then
    status=$?
    echo "agent CLI exited non-zero ($status)" >&2
    rm -f "$prompt_file"
    return 1
  fi
  rm -f "$prompt_file"
  return 0
}
