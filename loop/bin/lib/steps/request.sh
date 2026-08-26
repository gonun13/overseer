#!/usr/bin/env bash
# The `request` step's logic, called in-process by loop/run. Lives here
# (rather than loop/run itself) so it sits next to its own teardown hook,
# mirroring the provider split's one-id-one-file shape. There used to also
# be a standalone loop/bin/request script for exercising this step alone;
# once the step stabilized, that added nothing loop/run couldn't already
# do, so it was folded in here instead.

# step_request <workspace_dir> <name> <slug> [raw_input_file]
# Captures raw human intent and structures it into a request record. Prints
# the new request's id on stdout — nothing else; title/ref go to log_info
# (stderr) — so a caller can do `id=$(step_request ...)` cleanly. Dies (see
# common.sh) on any failure; raw input is written to disk before structuring
# is attempted, so a failed structuring pass never loses what the human typed.
step_request() {
  local workspace_dir=$1 name=$2 slug=$3 raw_input_file=${4:-}

  ensure_slug_dirs "$slug"

  local raw_text
  if [ -n "$raw_input_file" ]; then
    [ -f "$raw_input_file" ] || die "--file: no such file: $raw_input_file" 1
    raw_text=$(cat "$raw_input_file")
  else
    raw_text=$(read_multiline_input)
  fi

  if [ -z "$(printf '%s' "$raw_text" | tr -d '[:space:]')" ]; then
    die "no request text received — aborting" 3
  fi

  local id submitted_at raw_file raw_ref record_file record_ref
  id=$(gen_request_id)
  submitted_at=$(iso_now)

  raw_file=$(raw_path "$slug" "$id")
  printf '%s\n' "$raw_text" > "$raw_file"
  raw_ref="db/$slug/raw/$id.txt"

  record_file=$(record_path "$slug" "$id")
  record_ref="db/$slug/requests/$id.md"

  log_info "structuring request $id via provider '$PROVIDER_ID'…"

  if ! provider_structure "$raw_file" "$record_file" "$id" "$name" "$slug" "$submitted_at" "$raw_ref"; then
    die "structuring failed — raw request preserved at $raw_ref" 1
  fi

  if ! record_is_valid "$record_file" "$id" "$slug" "$submitted_at"; then
    die "provider '$PROVIDER_ID' did not write a valid record at $record_ref — raw request preserved at $raw_ref" 1
  fi

  local title
  title=$(record_title "$record_file")
  [ -n "$title" ] || title="(untitled)"

  append_event "$slug" "$id" "$submitted_at" "request" "created" "requested" "$title" "$raw_ref" "$record_ref"

  log_info "recorded $id for '$name' — $title ($record_ref)"
  printf '%s\n' "$id"
}

# step_teardown_hook <slug> <id> — see lib/steps.sh, used by loop/bin/clear.
# request is a synchronous, headless one-shot: stdin capture + a single
# structuring call, nothing left mounted, locked, or running afterward.
# Nothing to dismount.
step_teardown_hook() {
  :
}
