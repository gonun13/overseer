#!/usr/bin/env bash
# File-database helpers for loop/*. Path/IO layer only — no CLI-invocation
# knowledge lives here. Requires common.sh to already be sourced (LOOP_DIR).

slug_dir() { printf '%s/db/%s' "$LOOP_DIR" "$1"; }

ensure_slug_dirs() {
  local slug=$1
  mkdir -p "$(slug_dir "$slug")/requests" "$(slug_dir "$slug")/raw"
}

record_path() { printf '%s/requests/%s.md' "$(slug_dir "$1")" "$2"; }
raw_path()    { printf '%s/raw/%s.txt' "$(slug_dir "$1")" "$2"; }
index_path()  { printf '%s/index.jsonl' "$(slug_dir "$1")"; }
lock_path()   { printf '%s/.lock' "$(slug_dir "$1")"; }

# record_frontmatter_get <file> <key> — line-based extraction between the
# first two `---` delimiters, tolerant of malformed files, no YAML library.
# Mirrors the convention packages/adapters/claude-code/src/custom-agents.ts
# uses for name/description frontmatter.
record_frontmatter_get() {
  local file=$1 key=$2
  awk -v key="$key" '
    /^---[[:space:]]*$/ { n++; next }
    n==1 {
      if ($0 ~ "^" key ":") {
        sub("^" key ":[[:space:]]*", "");
        print;
        exit
      }
    }
    n>=2 { exit }
  ' "$file"
}

# record_title <file> — the first top-level markdown heading in the body.
record_title() {
  local file=$1
  grep -m1 '^# ' "$file" | sed 's/^# *//'
}

# record_is_valid <file> — required frontmatter keys present + a title
# heading exists. Never trust a provider's write blindly.
record_is_valid() {
  local file=$1 key val
  [ -f "$file" ] || return 1
  [ "$(head -n1 "$file")" = "---" ] || return 1
  for key in id workspace slug kind status step submitted_at; do
    val=$(record_frontmatter_get "$file" "$key")
    [ -n "$val" ] || return 1
  done
  grep -q '^# ' "$file" || return 1
  return 0
}

# _append_line <slug> <line> — raw, unlocked append. Callers must already
# hold the slug's flock (see append_event/clear_request below) — this never
# locks itself, so it must never be called outside one.
_append_line() {
  local slug=$1 line=$2
  printf '%s\n' "$line" >> "$(index_path "$slug")"
}

# append_event <slug> <id> <at> <step> <event> <status> <title> <raw_ref> <record_ref>
# The sole mutator of index.jsonl — flock-serialized so concurrent
# `loop/request`/`loop/clear` runs on the same slug can't interleave writes.
append_event() {
  local slug=$1 id=$2 at=$3 step=$4 event=$5 status=$6 title=$7 raw_ref=$8 record_ref=$9
  local lock line
  lock=$(lock_path "$slug")
  (
    flock -x 9
    line=$(jq -nc \
      --arg at "$at" \
      --arg id "$id" \
      --arg step "$step" \
      --arg event "$event" \
      --arg status "$status" \
      --arg title "$title" \
      --arg raw_ref "$raw_ref" \
      --arg record_ref "$record_ref" \
      '{at:$at, id:$id, step:$step, event:$event, status:$status, title:$title, raw_ref:$raw_ref, record_ref:$record_ref}')
    _append_line "$slug" "$line"
  ) 9>>"$lock"
}

# latest_request_events <slug> — one JSON line per request id: its most
# recent lifecycle event. index.jsonl is append-only, so the last line
# recorded for a given id is its current state — this is the mechanism the
# README describes instead of a separate state cache. Empty output (not an
# error) if the slug has no index yet.
latest_request_events() {
  local slug=$1 idx
  idx=$(index_path "$slug")
  [ -f "$idx" ] || return 0
  jq -c -s 'group_by(.id) | map(last) | .[]' "$idx"
}

# clear_request <slug> <id> <step> <title> <raw_ref> <record_ref> — deletes
# a request's raw/record files and appends its "cleared" event, both inside
# one flock so this can't interleave with a concurrent loop/request or
# loop/clear on the same slug. Files are deleted; index.jsonl never is
# (append-only, per the taxonomy) — the cleared event is the permanent
# record that this request existed and was removed.
clear_request() {
  local slug=$1 id=$2 step=$3 title=$4 raw_ref=$5 record_ref=$6
  local lock line
  lock=$(lock_path "$slug")
  (
    flock -x 9
    rm -f "$(record_path "$slug" "$id")" "$(raw_path "$slug" "$id")"
    line=$(jq -nc \
      --arg at "$(iso_now)" \
      --arg id "$id" \
      --arg step "$step" \
      --arg event "cleared" \
      --arg status "cleared" \
      --arg title "$title" \
      --arg raw_ref "$raw_ref" \
      --arg record_ref "$record_ref" \
      '{at:$at, id:$id, step:$step, event:$event, status:$status, title:$title, raw_ref:$raw_ref, record_ref:$record_ref}')
    _append_line "$slug" "$line"
  ) 9>>"$lock"
}
