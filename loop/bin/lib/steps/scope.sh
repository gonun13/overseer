#!/usr/bin/env bash
# The `scope` step's logic, called in-process by loop/run. See
# lib/steps/request.sh for why this lives here instead of a standalone
# script. Unlike request/research, this step is fully interactive — it's
# called directly from loop/run's own process, which inherits the real
# terminal the human is sitting at, so provider_scope's foreground claude
# session gets a real TTY same as if a human had typed the command by hand.

# step_scope <workspace_dir> <name> <slug> <id>
# An agent reads the request record and research report, grills the human
# with up to 20 questions, and writes the scope decision record. Dies (see
# common.sh) on any failure.
step_scope() {
  local workspace_dir=$1 name=$2 slug=$3 id=$4

  local event raw_ref
  event=$(latest_request_events "$slug" | jq -c --arg id "$id" 'select(.id == $id)')
  [ -n "$event" ] || die "no request '$id' found for '$name'" 1
  raw_ref=$(printf '%s' "$event" | jq -r '.raw_ref')

  local record_file research_file
  record_file=$(record_path "$slug" "$id")
  [ -f "$record_file" ] || die "no request record found at db/$slug/requests/$id.md for '$id'" 1
  research_file=$(research_path "$slug" "$id")
  [ -f "$research_file" ] || die "no research report found at db/$slug/research/$id.md for '$id'" 1

  ensure_slug_dirs "$slug"

  local decision_file scoped_at request_ref research_ref scope_ref
  decision_file=$(scope_path "$slug" "$id")
  scoped_at=$(iso_now)
  request_ref="db/$slug/requests/$id.md"
  research_ref="db/$slug/research/$id.md"
  scope_ref="db/$slug/scope/$id.md"

  log_info "scoping $id via provider '$PROVIDER_ID'…"

  if ! provider_scope "$record_file" "$research_file" "$decision_file" "$id" "$name" "$slug" "$scoped_at" "$request_ref" "$research_ref"; then
    die "scoping failed — request/research records untouched" 1
  fi

  if ! scope_is_valid "$decision_file" "$id" "$slug" "$scoped_at" "$request_ref" "$research_ref"; then
    die "provider '$PROVIDER_ID' did not write a valid scope decision record at $scope_ref" 1
  fi

  local title
  title=$(record_title "$record_file")
  [ -n "$title" ] || title="(untitled)"

  append_event "$slug" "$id" "$scoped_at" "scope" "completed" "scoped" "$title" "$raw_ref" "$scope_ref"

  log_info "scoped $id for '$name' — $scope_ref"
}

# step_teardown_hook <slug> <id> — see lib/steps.sh, used by loop/bin/clear.
# scope is a synchronous, interactive foreground call: it reads two files
# and writes one, with the human answering questions in the same terminal.
# Nothing left mounted, locked, or running afterward. Nothing to dismount.
step_teardown_hook() {
  :
}
