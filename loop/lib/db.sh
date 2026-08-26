#!/usr/bin/env bash
# File-database helpers for loop/*. Path/IO layer only — no CLI-invocation
# knowledge lives here. Requires common.sh to already be sourced (LOOP_DIR).

slug_dir() { printf '%s/db/%s' "$LOOP_DIR" "$1"; }

ensure_slug_dirs() {
  local slug=$1
  mkdir -p "$(slug_dir "$slug")/requests" "$(slug_dir "$slug")/raw" "$(slug_dir "$slug")/research" "$(slug_dir "$slug")/scope"
}

record_path()   { printf '%s/requests/%s.md' "$(slug_dir "$1")" "$2"; }
raw_path()      { printf '%s/raw/%s.txt' "$(slug_dir "$1")" "$2"; }
research_path() { printf '%s/research/%s.md' "$(slug_dir "$1")" "$2"; }
scope_path()    { printf '%s/scope/%s.md' "$(slug_dir "$1")" "$2"; }
memory_path()   { printf '%s/memory.md' "$(slug_dir "$1")"; }
index_path()    { printf '%s/index.jsonl' "$(slug_dir "$1")"; }
lock_path()     { printf '%s/.lock' "$(slug_dir "$1")"; }

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

# record_is_valid <file> <expected_id> <expected_slug> <expected_submitted_at>
# Required frontmatter keys present, a title heading exists, AND id/slug/
# submitted_at match what bash already independently knows — presence alone
# isn't enough: a provider can write non-empty values into the wrong slots
# (values shifted between fields), which presence-only checking can't catch.
# Never trust a provider's write blindly.
record_is_valid() {
  local file=$1 expected_id=$2 expected_slug=$3 expected_submitted_at=$4
  local key val
  [ -f "$file" ] || return 1
  [ "$(head -n1 "$file")" = "---" ] || return 1
  for key in id workspace slug kind status step submitted_at; do
    val=$(record_frontmatter_get "$file" "$key")
    [ -n "$val" ] || return 1
  done
  [ "$(record_frontmatter_get "$file" id)" = "$expected_id" ] || return 1
  [ "$(record_frontmatter_get "$file" slug)" = "$expected_slug" ] || return 1
  [ "$(record_frontmatter_get "$file" submitted_at)" = "$expected_submitted_at" ] || return 1
  grep -q '^# ' "$file" || return 1
  return 0
}

# research_is_valid <file> <expected_id> <expected_slug>
#   <expected_researched_at> <expected_request_ref>
# Same shape/principle as record_is_valid, for research reports.
research_is_valid() {
  local file=$1 expected_id=$2 expected_slug=$3 expected_researched_at=$4 expected_request_ref=$5
  local key val
  [ -f "$file" ] || return 1
  [ "$(head -n1 "$file")" = "---" ] || return 1
  for key in id workspace slug status step researched_at request_ref; do
    val=$(record_frontmatter_get "$file" "$key")
    [ -n "$val" ] || return 1
  done
  [ "$(record_frontmatter_get "$file" id)" = "$expected_id" ] || return 1
  [ "$(record_frontmatter_get "$file" slug)" = "$expected_slug" ] || return 1
  [ "$(record_frontmatter_get "$file" researched_at)" = "$expected_researched_at" ] || return 1
  [ "$(record_frontmatter_get "$file" request_ref)" = "$expected_request_ref" ] || return 1
  grep -q '^# ' "$file" || return 1
  return 0
}

# scope_is_valid <file> <expected_id> <expected_slug> <expected_scoped_at>
#   <expected_request_ref> <expected_research_ref>
# Same shape/principle as research_is_valid, for scope decision records.
scope_is_valid() {
  local file=$1 expected_id=$2 expected_slug=$3 expected_scoped_at=$4
  local expected_request_ref=$5 expected_research_ref=$6
  local key val
  [ -f "$file" ] || return 1
  [ "$(head -n1 "$file")" = "---" ] || return 1
  for key in id workspace slug status step scoped_at request_ref research_ref; do
    val=$(record_frontmatter_get "$file" "$key")
    [ -n "$val" ] || return 1
  done
  [ "$(record_frontmatter_get "$file" id)" = "$expected_id" ] || return 1
  [ "$(record_frontmatter_get "$file" slug)" = "$expected_slug" ] || return 1
  [ "$(record_frontmatter_get "$file" scoped_at)" = "$expected_scoped_at" ] || return 1
  [ "$(record_frontmatter_get "$file" request_ref)" = "$expected_request_ref" ] || return 1
  [ "$(record_frontmatter_get "$file" research_ref)" = "$expected_research_ref" ] || return 1
  grep -q '^# ' "$file" || return 1
  return 0
}

# memory_is_valid <file> — memory.md has no frontmatter (not tied to one
# request id), so its contract is lighter: exists, non-empty, and its first
# non-blank line is a top-level heading.
memory_is_valid() {
  local file=$1 first_line
  [ -s "$file" ] || return 1
  first_line=$(grep -m1 '.' "$file")
  [[ "$first_line" =~ ^#\  ]] || return 1
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
# `loop/request`/`loop/research`/`loop/clear` runs on the same slug can't interleave writes.
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
# a request's raw/record/research/scope files and appends its "cleared"
# event, all inside one flock so this can't interleave with a concurrent
# loop/request, loop/research, loop/scope, or loop/clear on the same slug.
# Files are deleted; index.jsonl never is (append-only, per the taxonomy) —
# the cleared event is the permanent record that this request existed and
# was removed. memory.md is deliberately NOT touched here: it's cumulative
# and shared across every request for the slug, and must outlive any single
# request's clear.
clear_request() {
  local slug=$1 id=$2 step=$3 title=$4 raw_ref=$5 record_ref=$6
  local lock line
  lock=$(lock_path "$slug")
  (
    flock -x 9
    rm -f "$(record_path "$slug" "$id")" "$(raw_path "$slug" "$id")" "$(research_path "$slug" "$id")" "$(scope_path "$slug" "$id")"
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
