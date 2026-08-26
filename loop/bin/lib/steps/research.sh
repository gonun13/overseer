#!/usr/bin/env bash
# The `research` step's logic, called in-process by loop/run. See
# lib/steps/request.sh for why this lives here instead of a standalone
# script.

# step_research <workspace_dir> <name> <slug> <id>
# Explores the codebase for a request already past `request`, writes a
# context report, and updates the shared memory file. Fully automated — no
# human in the loop. Dies (see common.sh) on any failure.
step_research() {
  local workspace_dir=$1 name=$2 slug=$3 id=$4

  local event raw_ref
  event=$(latest_request_events "$slug" | jq -c --arg id "$id" 'select(.id == $id)')
  [ -n "$event" ] || die "no request '$id' found for '$name'" 1
  raw_ref=$(printf '%s' "$event" | jq -r '.raw_ref')

  local record_file
  record_file=$(record_path "$slug" "$id")
  [ -f "$record_file" ] || die "no request record found at db/$slug/requests/$id.md for '$id'" 1

  ensure_slug_dirs "$slug"

  local research_file memory_file researched_at request_ref research_ref
  research_file=$(research_path "$slug" "$id")
  memory_file=$(memory_path "$slug")
  researched_at=$(iso_now)
  request_ref="db/$slug/requests/$id.md"
  research_ref="db/$slug/research/$id.md"

  log_info "researching $id via provider '$PROVIDER_ID'…"

  if ! provider_research "$record_file" "$workspace_dir" "$memory_file" "$research_file" "$id" "$name" "$slug" "$researched_at" "$request_ref"; then
    die "research failed — request record untouched" 1
  fi

  if ! research_is_valid "$research_file" "$id" "$slug" "$researched_at" "$request_ref"; then
    die "provider '$PROVIDER_ID' did not write a valid research record at $research_ref" 1
  fi

  local title
  title=$(record_title "$record_file")
  [ -n "$title" ] || title="(untitled)"

  append_event "$slug" "$id" "$researched_at" "research" "completed" "researched" "$title" "$raw_ref" "$research_ref"

  log_info "researched $id for '$name' — $research_ref"
}

# step_teardown_hook <slug> <id> — see lib/steps.sh, used by loop/bin/clear.
# research is a synchronous, headless one-shot: it explores the workspace
# read-only and writes two files, nothing left mounted, locked, or running
# afterward. Nothing to dismount.
step_teardown_hook() {
  :
}
