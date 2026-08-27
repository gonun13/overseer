#!/usr/bin/env bash
# The cursor provider — Cursor Agent CLI (`agent`) implementing the same
# three built steps as claude-code. Invocations use cwd $PROVIDER_ROOT so
# project discovery sees only this bundle's .cursor/ (never loop/ root or
# another provider).
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

# _cursor_prompt <command-stem> <arg1> [arg2…]
# Command body + "Concrete arguments" block binding $1..$N.
_cursor_prompt() {
  local stem=$1
  shift
  local body
  body=$(_cursor_command_body "$stem") || return 1

  printf '%s\n\n' "$body"
  printf 'Concrete arguments (use these exact values for $1, $2, … — do not invent paths):\n'
  local i=1
  local a
  for a in "$@"; do
    printf '$%d = %s\n' "$i" "$a"
    i=$((i + 1))
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
    "$raw_file" "$record_file" "$id" "$workspace" "$slug" "$submitted_at" "$raw_ref") || return 1

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
    "$record_file" "$workspace_dir" "$memory_file" "$research_file" \
    "$id" "$workspace" "$slug" "$researched_at" "$request_ref") || return 1

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
#   <slug> <scoped_at> <request_ref> <research_ref>
# Always interactive — grilling the human *is* the step. No headless path.
# Caller still validates via scope_is_valid().
provider_scope() {
  local record_file=$1 research_file=$2 decision_file=$3 id=$4 workspace=$5
  local slug=$6 scoped_at=$7 request_ref=$8 research_ref=$9
  local prompt
  prompt=$(_cursor_prompt scope-request \
    "$record_file" "$research_file" "$decision_file" \
    "$id" "$workspace" "$slug" "$scoped_at" "$request_ref" "$research_ref") || return 1

  (cd "$PROVIDER_ROOT" && agent --workspace "$PROVIDER_ROOT" --force --trust "$prompt")
  local status=$?
  if [ "$status" -ne 0 ]; then
    echo "agent CLI exited non-zero ($status)" >&2
    return 1
  fi
  return 0
}
