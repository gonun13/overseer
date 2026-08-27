#!/usr/bin/env bash
# The `scope` step's logic, called in-process by loop/run. See
# lib/steps/request.sh for why this lives here instead of a standalone
# script. Unlike request/research, this step is fully interactive — it's
# called directly from loop/run's own process, which inherits the real
# terminal the human is sitting at, so provider_scope's foreground interactive
# session gets a real TTY same as if a human had typed the command by hand.
# The same session continues into planning when possible (writes plan/<id>.md).

# step_scope <workspace_dir> <name> <slug> <id>
# An agent reads the request record and research report, grills the human
# with up to 20 questions, writes the scope decision record, then continues
# into the plan for this request in the same session when it can. Dies (see
# common.sh) on any failure of the scope write. If the in-session plan is
# missing/invalid, the caller should fall back to step_plan.
step_scope() {
  local workspace_dir=$1 name=$2 slug=$3 id=$4

  local event raw_ref
  event=$(latest_request_events "$slug" | jq -c --arg id "$id" 'select(.id == $id)')
  [ -n "$event" ] || die "no request '$id' found for '$name'" 1
  raw_ref=$(printf '%s' "$event" | jq -r '.raw_ref')

  local record_file research_file memory_file
  record_file=$(record_path "$slug" "$id")
  [ -f "$record_file" ] || die "no request record found at db/$slug/requests/$id.md for '$id'" 1
  research_file=$(research_path "$slug" "$id")
  [ -f "$research_file" ] || die "no research report found at db/$slug/research/$id.md for '$id'" 1
  memory_file=$(memory_path "$slug")

  ensure_slug_dirs "$slug"

  local decision_file plan_file scoped_at planned_at request_ref research_ref scope_ref
  decision_file=$(scope_path "$slug" "$id")
  plan_file=$(plan_path "$slug" "$id")
  scoped_at=$(iso_now)
  planned_at=$(iso_now)
  request_ref="db/$slug/requests/$id.md"
  research_ref="db/$slug/research/$id.md"
  scope_ref="db/$slug/scope/$id.md"

  local held
  held=$(running_get "$slug" || true)
  if [ -n "$held" ]; then
    die "workspace '$name' is already running $(printf '%s' "$held" | jq -r '"\(.step) on \(.id) (pid \(.pid))"')" 1
  fi
  if ! running_claim "$slug" "$id" "scope"; then
    die "could not claim running lease for '$name' — another terminal holds it" 1
  fi

  log_info "scoping $id via provider '$PROVIDER_ID' (continues into plan in-session)…"

  local scope_ok=0
  if provider_scope "$record_file" "$research_file" "$decision_file" "$id" "$name" "$slug" \
      "$scoped_at" "$request_ref" "$research_ref" \
      "$plan_file" "$planned_at" "$scope_ref" "$workspace_dir" "$memory_file"; then
    if scope_is_valid "$decision_file" "$id" "$slug" "$scoped_at" "$request_ref" "$research_ref"; then
      scope_ok=1
    fi
  fi

  if [ "$scope_ok" -ne 1 ]; then
    running_release "$slug" "$id"
    die "scoping failed — request/research records untouched" 1
  fi

  local title
  title=$(record_title "$record_file")
  [ -n "$title" ] || title="(untitled)"

  append_event "$slug" "$id" "$scoped_at" "scope" "completed" "scoped" "$title" "$raw_ref" "$scope_ref"
  log_info "scoped $id for '$name' — $scope_ref"

  # In-session plan: provider may have written plan_file already. Accept it
  # only if planned_at matches what we passed (same contract as headless).
  if plan_is_valid "$plan_file" "$id" "$slug" "$planned_at" "$request_ref" "$research_ref" "$scope_ref"; then
    local plan_ref="db/$slug/plan/$id.md"
    append_event "$slug" "$id" "$planned_at" "plan" "completed" "planned" "$title" "$raw_ref" "$plan_ref"
    running_release "$slug" "$id"
    log_info "planned $id for '$name' — $plan_ref (impact $(record_frontmatter_get "$plan_file" impact))"
    return 0
  fi

  running_release "$slug" "$id"
  log_info "scope session did not leave a valid plan — caller may run step_plan"
}

# step_teardown_hook <slug> <id> — see lib/steps.sh, used by loop/bin/clear.
step_teardown_hook() {
  local slug=$1 id=$2
  running_release "$slug" "$id"
}
