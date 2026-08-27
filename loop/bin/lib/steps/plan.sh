#!/usr/bin/env bash
# The `plan` step's logic, called in-process by loop/run. Fully automated
# one-shot when invoked here: reads scope/research/request/memory and writes
# plan/<id>.md. (Interactive scope may also write the plan in-session; this
# function is the headless path and the fallback when that didn't happen.)

# step_plan <workspace_dir> <name> <slug> <id>
# Claims the per-slug running lease, invokes provider_plan, validates the
# plan file, appends the index event, and releases the lease. Dies on failure.
step_plan() {
  local workspace_dir=$1 name=$2 slug=$3 id=$4

  local event raw_ref
  event=$(latest_request_events "$slug" | jq -c --arg id "$id" 'select(.id == $id)')
  [ -n "$event" ] || die "no request '$id' found for '$name'" 1
  raw_ref=$(printf '%s' "$event" | jq -r '.raw_ref')

  local record_file research_file scope_file memory_file
  record_file=$(record_path "$slug" "$id")
  [ -f "$record_file" ] || die "no request record found at db/$slug/requests/$id.md for '$id'" 1
  research_file=$(research_path "$slug" "$id")
  [ -f "$research_file" ] || die "no research report found at db/$slug/research/$id.md for '$id'" 1
  scope_file=$(scope_path "$slug" "$id")
  [ -f "$scope_file" ] || die "no scope decision found at db/$slug/scope/$id.md for '$id'" 1
  memory_file=$(memory_path "$slug")

  ensure_slug_dirs "$slug"

  local plan_file planned_at request_ref research_ref scope_ref plan_ref
  plan_file=$(plan_path "$slug" "$id")
  planned_at=$(iso_now)
  request_ref="db/$slug/requests/$id.md"
  research_ref="db/$slug/research/$id.md"
  scope_ref="db/$slug/scope/$id.md"
  plan_ref="db/$slug/plan/$id.md"

  local held
  held=$(running_get "$slug" || true)
  if [ -n "$held" ]; then
    die "workspace '$name' is already running $(printf '%s' "$held" | jq -r '"\(.step) on \(.id) (pid \(.pid))"')" 1
  fi
  if ! running_claim "$slug" "$id" "plan"; then
    die "could not claim running lease for '$name' — another terminal holds it" 1
  fi

  log_info "planning $id via provider '$PROVIDER_ID'…"

  local ok=0
  if provider_plan "$record_file" "$research_file" "$scope_file" "$memory_file" \
      "$workspace_dir" "$plan_file" "$id" "$name" "$slug" "$planned_at" \
      "$request_ref" "$research_ref" "$scope_ref"; then
    if plan_is_valid "$plan_file" "$id" "$slug" "$planned_at" "$request_ref" "$research_ref" "$scope_ref"; then
      ok=1
    else
      log_error "plan file failed validation:"
      plan_explain_invalid "$plan_file" "$id" "$slug" "$planned_at" "$request_ref" "$research_ref" "$scope_ref"
    fi
  else
    log_error "provider_plan returned failure"
  fi

  if [ "$ok" -ne 1 ]; then
    running_release "$slug" "$id"
    # Drop a corrupt/partial plan so the request stays pickable and retryable.
    rm -f "$plan_file"
    die "planning failed — scope/research records untouched" 1
  fi

  local title
  title=$(record_title "$record_file")
  [ -n "$title" ] || title="(untitled)"

  append_event "$slug" "$id" "$planned_at" "plan" "completed" "planned" "$title" "$raw_ref" "$plan_ref"
  running_release "$slug" "$id"

  log_info "planned $id for '$name' — $plan_ref (impact $(record_frontmatter_get "$plan_file" impact))"
}

# record_plan_if_present <slug> <id> <raw_ref> — when an interactive scope
# session already wrote a valid plan file, append the plan index event without
# re-invoking the provider. Returns 0 if recorded, 1 if no valid plan present.
record_plan_if_present() {
  local slug=$1 id=$2 raw_ref=$3
  local plan_file plan_ref planned_at title record_file
  plan_file=$(plan_path "$slug" "$id")
  plan_is_present_valid "$slug" "$id" || return 1
  planned_at=$(record_frontmatter_get "$plan_file" planned_at)
  plan_ref="db/$slug/plan/$id.md"
  record_file=$(record_path "$slug" "$id")
  title=$(record_title "$record_file")
  [ -n "$title" ] || title="(untitled)"
  append_event "$slug" "$id" "$planned_at" "plan" "completed" "planned" "$title" "$raw_ref" "$plan_ref"
  log_info "planned $id (written in scope session) — $plan_ref (impact $(record_frontmatter_get "$plan_file" impact))"
  return 0
}

# step_teardown_hook <slug> <id> — release a running lease held for this id.
step_teardown_hook() {
  local slug=$1 id=$2
  running_release "$slug" "$id"
}
