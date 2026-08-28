#!/usr/bin/env bash
# File-database helpers for loop/*. Path/IO layer only — no CLI-invocation
# knowledge lives here, and no control flow: nothing in this file decides what
# the loop does next. Requires common.sh to already be sourced (LOOP_DIR).

# --- The step spec table -----------------------------------------------------
#
# One row per artifact kind. Everything else in this file — paths, refs, the
# expected-frontmatter map, validation, ensure_slug_dirs, clear_request's
# deletion list — is derived from it, so adding a step is one row here plus one
# loop/steps/<step>.md.
#
# Fields, '|'-separated:
#   1 step            id, and the name of loop/steps/<step>.md
#   2 dir             db/<slug>/<dir>/
#   3 ext             file extension
#   4 done_status     the `status:` value a completed artifact carries.
#                     Empty means "not a step" (`raw` is human input, not an
#                     agent-written artifact) — nothing validates or records it.
#   5 at_key          the frontmatter timestamp key this step stamps
#   6 ref_steps       steps whose artifacts this one must reference; each
#                     contributes a required `<ref_step>_ref` key whose value
#                     is that artifact's canonical relative path
#   7 extra_required  further required keys, value not predictable by bash
#   8 int_keys        further required keys that must be integers >= 1
LOOP_STEPS=(
  "raw|raw|txt|||||"
  "request|requests|md|requested|submitted_at|raw|kind|"
  "research|research|md|researched|researched_at|request||"
  "scope|scope|md|scoped|scoped_at|request research|questions_asked|"
  "plan|plan|md|planned|planned_at|request research scope||impact phase_count"
  "implement|implement|md|implemented|implemented_at|request research scope plan|tracers|"
)

# --- The exclusive-phase lock ------------------------------------------------
#
# Steps that take the workspace's working tree. One request may hold it at a
# time: two of them editing the same tree is exactly the conflict this prevents.
# It is claimed by `loop/bin/step` and, unlike the session lease, deliberately
# outlives the session — a restarted overseer must find the request still
# holding it. `loop/bin/phase` and `loop/bin/clear` are what release it.
LOOP_EXCLUSIVE_STEPS="implement verify decide"

# step_is_exclusive <step> — 0 if that step takes the working tree.
step_is_exclusive() {
  case " $LOOP_EXCLUSIVE_STEPS " in
    *" $1 "*) return 0 ;;
  esac
  return 1
}

# step_field <step> <field-number> — one field of that step's row. Returns 1
# for an unknown step, so callers can validate a step name by calling this.
step_field() {
  local step=$1 n=$2 row
  for row in "${LOOP_STEPS[@]}"; do
    if [ "${row%%|*}" = "$step" ]; then
      printf '%s' "$row" | cut -d'|' -f"$n"
      return 0
    fi
  done
  return 1
}

# step_names — every real step (i.e. not `raw`), in loop order.
step_names() {
  local row
  for row in "${LOOP_STEPS[@]}"; do
    [ -n "$(printf '%s' "$row" | cut -d'|' -f4)" ] || continue
    printf '%s\n' "${row%%|*}"
  done
}

# require_step <step> — die unless <step> is a real step.
require_step() {
  local step=$1 status
  status=$(step_field "$step" 4) \
    || die "unknown step '$step' — known steps: $(step_names | tr '\n' ' ')" 1
  [ -n "$status" ] || die "'$step' is not a step (it is raw human input)" 1
}

# --- Paths -------------------------------------------------------------------

slug_dir() { printf '%s/db/%s' "$LOOP_DIR" "$1"; }

# artifact_path <slug> <step> <id> — absolute path to that artifact.
artifact_path() {
  local slug=$1 step=$2 id=$3 dir ext
  dir=$(step_field "$step" 2) || die "unknown step '$step'" 1
  ext=$(step_field "$step" 3)
  printf '%s/%s/%s.%s' "$(slug_dir "$slug")" "$dir" "$id" "$ext"
}

# artifact_ref <slug> <step> <id> — the repo-relative path string that goes
# into another artifact's frontmatter. Same shape as artifact_path, derived
# from the same row, so the two can never drift apart.
artifact_ref() {
  local slug=$1 step=$2 id=$3 dir ext
  dir=$(step_field "$step" 2) || die "unknown step '$step'" 1
  ext=$(step_field "$step" 3)
  printf 'db/%s/%s/%s.%s' "$slug" "$dir" "$id" "$ext"
}

memory_path()  { printf '%s/memory.md' "$(slug_dir "$1")"; }
index_path()   { printf '%s/index.jsonl' "$(slug_dir "$1")"; }
# The slug's flock mutex — every mutator serializes on this one file.
lock_path()    { printf '%s/.lock' "$(slug_dir "$1")"; }
running_path() { printf '%s/running.json' "$(slug_dir "$1")"; }
# The exclusive-phase lock (see LOOP_EXCLUSIVE_STEPS) — not a mutex, a holder
# record: one line naming the request that owns the working tree.
impl_lock_path() { printf '%s/implement.lock' "$(slug_dir "$1")"; }

ensure_slug_dirs() {
  local slug=$1 row dir
  for row in "${LOOP_STEPS[@]}"; do
    dir=$(printf '%s' "$row" | cut -d'|' -f2)
    mkdir -p "$(slug_dir "$slug")/$dir"
  done
}

# --- Frontmatter -------------------------------------------------------------

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

# plan_tracers <plan-file> — one `id<TAB>phase<TAB>parallel<TAB>phase_label<TAB>goal`
# line per tracer, in plan order, from the `#### Tracer` blocks steps/plan.md
# writes. Phase is a 1-based index over the `### Phase` headings, so ordering
# never depends on how a planner numbered or named them.
#
# This is the only place plan markdown is parsed. Nothing else — least of all
# the overseer — should be grepping an artifact to work out what is left to do.
plan_tracers() {
  local file=$1
  [ -f "$file" ] || return 0
  awk '
    function flush(   g) {
      if (id != "") {
        g = goal
        gsub(/\t/, " ", g)
        printf "%s\t%d\t%s\t%s\t%s\n", id, phase, par, label, g
      }
      id = ""; goal = ""; par = "false"
    }
    /^###[[:space:]]+Phase[[:space:]]/ {
      flush()
      phase++
      label = $0
      sub(/^###[[:space:]]+Phase[[:space:]]+/, "", label)
      gsub(/\t/, " ", label)
      next
    }
    /^####[[:space:]]+Tracer/ {
      flush()
      if (match($0, /`[^`]+`/)) id = substr($0, RSTART + 1, RLENGTH - 2)
      next
    }
    id != "" && /^-[[:space:]]*Goal:/ && goal == "" {
      goal = $0
      sub(/^-[[:space:]]*Goal:[[:space:]]*/, "", goal)
      next
    }
    id != "" && /^-[[:space:]]*Parallel:/ {
      par = $0
      sub(/^-[[:space:]]*Parallel:[[:space:]]*/, "", par)
      gsub(/[[:space:]]/, "", par)
      if (par != "true") par = "false"
      next
    }
    END { flush() }
  ' "$file"
}

# ledger_statuses <implement-file> — one `tracer<TAB>status` line per row of the
# implement record's tracer ledger table. Empty (not an error) when no record
# exists yet: nothing has been implemented, so nothing is done.
ledger_statuses() {
  local file=$1
  [ -f "$file" ] || return 0
  awk -F'|' '
    /^\|[[:space:]]*p[0-9]+\.t[0-9]+[[:space:]]*\|/ {
      t = $2; s = $3
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", t)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", s)
      print t "\t" s
    }
  ' "$file"
}

# expected_frontmatter <slug> <workspace> <id> <step> <at> — prints the
# frontmatter keys whose values bash already knows, one `key<TAB>value` line
# each. This is both what `loop/bin/step` hands a step to copy verbatim and
# what `loop/bin/record` checks the written file against — one source, so a
# step can't be told one thing and judged by another.
expected_frontmatter() {
  local slug=$1 workspace=$2 id=$3 step=$4 at=$5
  local at_key ref_step
  at_key=$(step_field "$step" 5)

  printf 'id\t%s\n' "$id"
  printf 'workspace\t%s\n' "$workspace"
  printf 'slug\t%s\n' "$slug"
  printf 'status\t%s\n' "$(step_field "$step" 4)"
  printf 'step\t%s\n' "$step"
  # An empty <at> means "the caller only wants the keys it can compare" —
  # artifact_validate checks the timestamp's shape separately, below.
  if [ -n "$at_key" ] && [ -n "$at" ]; then
    printf '%s\t%s\n' "$at_key" "$at"
  fi
  for ref_step in $(step_field "$step" 6); do
    printf '%s_ref\t%s\n' "$ref_step" "$(artifact_ref "$slug" "$ref_step" "$id")"
  done
}

# open_frontmatter <step> — the required keys whose values bash cannot predict,
# one `key<TAB>constraint` line each. The step itself must supply them.
open_frontmatter() {
  local step=$1 key
  for key in $(step_field "$step" 7); do
    printf '%s\ttext\n' "$key"
  done
  for key in $(step_field "$step" 8); do
    printf '%s\tinteger >= 1\n' "$key"
  done
}

# --- Validation --------------------------------------------------------------

# artifact_validate <slug> <workspace> <id> <step>
# Checks the file a step wrote against everything bash independently knows.
# Never trust a provider's write: presence alone isn't enough, because values
# can land in each other's fields (non-empty, so a presence check passes, but
# wrong) — so every key bash can predict is compared, not just counted.
# Prints a per-key actual-vs-expected dump to stderr on failure.
artifact_validate() {
  local slug=$1 workspace=$2 id=$3 step=$4
  local file at_key key want got ok=0
  file=$(artifact_path "$slug" "$step" "$id")
  at_key=$(step_field "$step" 5)

  if [ ! -f "$file" ]; then
    printf 'no %s artifact written at %s\n' "$step" "$file" >&2
    return 1
  fi
  if [ "$(head -n1 "$file")" != "---" ]; then
    printf '%s: first line is not a `---` frontmatter delimiter\n' "$file" >&2
    return 1
  fi

  while IFS=$'\t' read -r key want; do
    got=$(record_frontmatter_get "$file" "$key")
    [ "$got" = "$want" ] && continue
    [ "$ok" -eq 0 ] && printf '%s: frontmatter does not match what this step was given\n' "$file" >&2
    ok=1
    printf '  %-14s expected %-56s got %s\n' "$key:" "$want" "${got:-<empty>}" >&2
  done < <(expected_frontmatter "$slug" "$workspace" "$id" "$step" "")

  # The timestamp is checked for shape, not equality: it is stamped by
  # `loop/bin/step` and validated by a later `loop/bin/record` invocation, so
  # bash no longer holds the exact value. Shape is what actually catches a
  # mangled copy (an unexpanded argument, a truncated string) landing here.
  if [ -n "$at_key" ]; then
    got=$(record_frontmatter_get "$file" "$at_key")
    if ! [[ "$got" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]; then
      [ "$ok" -eq 0 ] && printf '%s: frontmatter is not valid\n' "$file" >&2
      ok=1
      printf '  %-14s expected an ISO 8601 UTC timestamp     got %s\n' "$at_key:" "${got:-<empty>}" >&2
    fi
  fi

  for key in $(step_field "$step" 7); do
    got=$(record_frontmatter_get "$file" "$key")
    [ -n "$got" ] && continue
    [ "$ok" -eq 0 ] && printf '%s: frontmatter is not valid\n' "$file" >&2
    ok=1
    printf '  %-14s required, must not be empty\n' "$key:" >&2
  done

  for key in $(step_field "$step" 8); do
    got=$(record_frontmatter_get "$file" "$key")
    [[ "$got" =~ ^[1-9][0-9]*$ ]] && continue
    [ "$ok" -eq 0 ] && printf '%s: frontmatter is not valid\n' "$file" >&2
    ok=1
    printf '  %-14s expected an integer >= 1                got %s\n' "$key:" "${got:-<empty>}" >&2
  done

  if ! grep -q '^# ' "$file"; then
    [ "$ok" -eq 0 ] && printf '%s: is not valid\n' "$file" >&2
    ok=1
    printf '  body is missing a `# ` title heading\n' >&2
  fi

  return "$ok"
}

# --- The session lease -------------------------------------------------------
#
# One overseer session per workspace. loop/run claims this at startup and
# releases it from an EXIT trap, so another terminal can see that a workspace
# is already being driven. It is automation state, not a fourth taxonomy kind.

# _running_pid_alive <pid> — 0 if a process with that pid exists.
_running_pid_alive() {
  local pid=$1
  [ -n "$pid" ] || return 1
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

# running_get <slug> — prints the current running.json (one line) if present
# and its holder is still alive; otherwise nothing. Reaps a stale lease.
running_get() {
  local slug=$1 path pid
  path=$(running_path "$slug")
  [ -f "$path" ] || return 0
  pid=$(jq -r '.pid // empty' "$path" 2>/dev/null) || { rm -f "$path"; return 0; }
  if _running_pid_alive "$pid"; then
    cat "$path"
    return 0
  fi
  rm -f "$path"
  return 0
}

# running_claim <slug> — exclusive per-slug session lease. Returns 1 (and
# prints the holder) if another live process already holds it.
running_claim() {
  local slug=$1 lock path existing
  lock=$(lock_path "$slug")
  path=$(running_path "$slug")
  ensure_slug_dirs "$slug"
  (
    flock -x 9
    if [ -f "$path" ]; then
      existing=$(cat "$path")
      if _running_pid_alive "$(printf '%s' "$existing" | jq -r '.pid // empty')"; then
        printf '%s\n' "$existing" >&2
        exit 1
      fi
      rm -f "$path"
    fi
    jq -nc \
      --arg slug "$slug" \
      --argjson pid "$$" \
      --arg started_at "$(iso_now)" \
      --arg tty "${TTY:-${TERM:-unknown}}" \
      '{slug:$slug, pid:$pid, started_at:$started_at, tty:$tty}' > "$path"
  ) 9>>"$lock"
}

# running_release <slug> — drop the lease if this process holds it. A lease
# held by a still-live other process is left alone.
running_release() {
  local slug=$1 lock path cur
  lock=$(lock_path "$slug")
  path=$(running_path "$slug")
  (
    flock -x 9
    [ -f "$path" ] || exit 0
    cur=$(jq -r '.pid // empty' "$path" 2>/dev/null || true)
    if [ "$cur" = "$$" ] || ! _running_pid_alive "$cur"; then
      rm -f "$path"
    fi
  ) 9>>"$lock"
}

# --- The exclusive-phase lock ------------------------------------------------
#
# db/<slug>/implement.lock is two lines of plain text — no JSON, no pid, so
# nothing here needs jq and, unlike the session lease, there is no holder
# process to reap:
#
#   1. the id of the request that owns the workspace's working tree
#   2. the exclusive steps that have already *recorded* under this claim
#
# loop/bin/step claims it; only loop/bin/phase and loop/bin/clear drop it, so
# a request stays in the implement/verify/decide phase across overseer restarts
# until a human says otherwise.
#
# Line 2 is what stops a request building on its own unjudged work: once
# `implement` has recorded under this claim, the next run needs a fresh claim,
# and a fresh claim is what releasing the phase grants. It is scoped to the
# claim rather than derived from the request's status precisely so that a run
# whose `record` failed — nothing recorded, so nothing marked — can still be
# retried.

# impl_lock_holder <slug> — the holding request id, or nothing.
impl_lock_holder() {
  local path
  path=$(impl_lock_path "$1")
  [ -f "$path" ] || return 0
  sed -n 1p "$path"
}

# impl_lock_recorded <slug> <step> — 0 if that step has already recorded under
# the current claim.
impl_lock_recorded() {
  local path marked
  path=$(impl_lock_path "$1")
  [ -f "$path" ] || return 1
  marked=$(sed -n 2p "$path")
  case " $marked " in
    *" $2 "*) return 0 ;;
  esac
  return 1
}

# pending_tracers <slug> <id> — tracer ids from that request's plan its
# implement ledger does not mark done, one per line. Empty when the plan is
# fully implemented, and when there is no plan at all.
pending_tracers() {
  local slug=$1 id=$2 plan_file t s
  declare -A done_of=()
  plan_file=$(artifact_path "$slug" plan "$id")
  [ -f "$plan_file" ] || return 0
  while IFS=$'\t' read -r t s; do
    [ "$s" = "done" ] && done_of["$t"]=1
  done < <(ledger_statuses "$(artifact_path "$slug" implement "$id")")
  while IFS=$'\t' read -r t _; do
    [ -n "$t" ] || continue
    [ -n "${done_of[$t]:-}" ] || printf '%s\n' "$t"
  done < <(plan_tracers "$plan_file")
}

# impl_lock_mark <slug> <step> — note that <step> has recorded under the
# current claim. Called by loop/bin/record, after the event is committed.
impl_lock_mark() {
  local slug=$1 step=$2 lock path id marked
  lock=$(lock_path "$slug")
  path=$(impl_lock_path "$slug")
  (
    flock -x 9
    [ -f "$path" ] || exit 0
    id=$(sed -n 1p "$path")
    marked=$(sed -n 2p "$path")
    case " $marked " in
      *" $step "*) exit 0 ;;
    esac
    printf '%s\n%s\n' "$id" "${marked:+$marked }$step" > "$path"
  ) 9>>"$lock"
}

# _impl_lock_release <slug> — raw, unlocked removal. Callers must already hold
# the slug's flock (see impl_lock_release and clear_request below) — this never
# locks itself, so it must never be called outside one.
_impl_lock_release() {
  rm -f "$(impl_lock_path "$1")"
}

# impl_lock_claim <slug> <id> — take the exclusive phase for that request.
# Returns 1, printing the current holder, when a *different* request holds it.
# Re-claiming for the same id succeeds and leaves the file untouched: that is
# how one request moves implement -> verify -> decide and retries a run whose
# record failed — and leaving it untouched is what keeps line 2's memory of
# what this claim already recorded.
impl_lock_claim() {
  local slug=$1 id=$2 lock path held
  lock=$(lock_path "$slug")
  path=$(impl_lock_path "$slug")
  ensure_slug_dirs "$slug"
  (
    flock -x 9
    if [ -f "$path" ]; then
      held=$(sed -n 1p "$path")
      if [ -n "$held" ]; then
        if [ "$held" != "$id" ]; then
          printf '%s\n' "$held" >&2
          exit 1
        fi
        exit 0
      fi
    fi
    printf '%s\n' "$id" > "$path"
  ) 9>>"$lock"
}

# impl_lock_release <slug> — drop the lock, whoever holds it. The release valve
# behind loop/bin/phase --release: a human decides when the phase is over, because the
# step that would decide it (`decide`) is not built yet.
impl_lock_release() {
  local slug=$1 lock
  lock=$(lock_path "$slug")
  (
    flock -x 9
    _impl_lock_release "$slug"
  ) 9>>"$lock"
}

# --- index.jsonl -------------------------------------------------------------

# _append_line <slug> <line> — raw, unlocked append. Callers must already hold
# the slug's flock (see append_event/clear_request below) — this never locks
# itself, so it must never be called outside one.
_append_line() {
  local slug=$1 line=$2
  printf '%s\n' "$line" >> "$(index_path "$slug")"
}

# append_event <slug> <id> <at> <step> <event> <status> <title> <raw_ref> <record_ref>
# The sole mutator of index.jsonl — flock-serialized so concurrent loop
# commands on the same slug can't interleave writes.
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

# latest_request_events <slug> — one JSON line per request id: its most recent
# lifecycle event. index.jsonl is append-only, so the last line recorded for a
# given id is its current state — this is the mechanism the README describes
# instead of a separate state cache. Empty output (not an error) if the slug
# has no index yet.
latest_request_events() {
  local slug=$1 idx
  idx=$(index_path "$slug")
  [ -f "$idx" ] || return 0
  jq -c -s 'group_by(.id) | map(last) | .[]' "$idx"
}

# open_request_events <slug> — latest_request_events minus cleared requests.
open_request_events() {
  latest_request_events "$1" | jq -c 'select(.status != "cleared")'
}

# request_event <slug> <id> — that one request's latest event, or empty.
request_event() {
  local slug=$1 id=$2
  latest_request_events "$slug" | jq -c --arg id "$id" 'select(.id == $id)'
}

# clear_request <slug> <id> <step> <title> <raw_ref> <record_ref> — deletes
# every artifact this request owns (derived from the step table, so a step
# added later is cleared without touching this function) and appends its
# "cleared" event, all inside one flock so it can't interleave with a
# concurrent loop command on the same slug. Files are deleted; index.jsonl
# never is (append-only, per the taxonomy) — the cleared event is the permanent
# record that this request existed and was removed. memory.md is deliberately
# NOT touched: it's cumulative and shared across every request for the slug,
# and must outlive any single request's clear. The exclusive-phase lock IS
# dropped when this request holds it — a request that no longer exists must not
# keep the working tree hostage.
clear_request() {
  local slug=$1 id=$2 step=$3 title=$4 raw_ref=$5 record_ref=$6
  local lock line row
  lock=$(lock_path "$slug")
  (
    flock -x 9
    for row in "${LOOP_STEPS[@]}"; do
      rm -f "$(artifact_path "$slug" "${row%%|*}" "$id")"
    done
    if [ "$(impl_lock_holder "$slug")" = "$id" ]; then
      _impl_lock_release "$slug"
    fi
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

# --- The step context --------------------------------------------------------

# step_context_json <workspace> <slug> <id> <step> <workspace_dir> <at> [tracers]
# The single hand-off shape between bash and whoever runs a step. Everything is
# named: there are no positional arguments for a step to miscount, and the
# `frontmatter` block is the literal, complete set of values to copy — not
# prose describing which argument maps to which key.
#
# <tracers> applies to exclusive steps only, where that comma-separated list
# becomes a top-level `tracers` array: the slice of the plan to work in this
# run, or null for "pick the next pending group yourself". More than one id
# means the plan declared them parallel, so one run does the whole group. It
# stays out of `frontmatter` on purpose — bash does not hold it across the
# later `loop/bin/record` call, so there would be nothing to compare a copied
# value against.
#
# Dies if a required input artifact is missing, so a step is never started
# against a half-finished request.
step_context_json() {
  local workspace=$1 slug=$2 id=$3 step=$4 workspace_dir=$5 at=$6 tracers=${7:-}
  local ref_step file inputs='{}' front='{}' open='{}' key val ctx

  for ref_step in $(step_field "$step" 6); do
    file=$(artifact_path "$slug" "$ref_step" "$id")
    [ -f "$file" ] || die "cannot start '$step' for $id: missing input $(artifact_ref "$slug" "$ref_step" "$id")" 1
    inputs=$(jq -c --argjson acc "$inputs" --arg k "${ref_step}_file" --arg v "$file" \
      -n '$acc + {($k): $v}')
  done
  # memory.md is a workspace-wide document, not a per-request input: every step
  # may read it, and `research` also rewrites it. It legitimately may not exist
  # yet, so its path is handed over without an existence check.
  inputs=$(jq -c --argjson acc "$inputs" --arg v "$(memory_path "$slug")" \
    -n '$acc + {memory_file: $v}')

  while IFS=$'\t' read -r key val; do
    front=$(jq -c --argjson acc "$front" --arg k "$key" --arg v "$val" -n '$acc + {($k): $v}')
  done < <(expected_frontmatter "$slug" "$workspace" "$id" "$step" "$at")

  while IFS=$'\t' read -r key val; do
    open=$(jq -c --argjson acc "$open" --arg k "$key" --arg v "$val" -n '$acc + {($k): $v}')
  done < <(open_frontmatter "$step")

  ctx=$(jq -n \
    --arg step "$step" \
    --arg id "$id" \
    --arg workspace "$workspace" \
    --arg slug "$slug" \
    --arg workspace_dir "$workspace_dir" \
    --arg instructions "$LOOP_DIR/steps/$step.md" \
    --arg output_file "$(artifact_path "$slug" "$step" "$id")" \
    --argjson inputs "$inputs" \
    --argjson frontmatter "$front" \
    --argjson frontmatter_open "$open" \
    '{step:$step, id:$id, workspace:$workspace, slug:$slug,
      workspace_dir:$workspace_dir, instructions:$instructions,
      inputs:$inputs, output_file:$output_file,
      frontmatter:$frontmatter, frontmatter_open:$frontmatter_open}')

  # Only an exclusive step gets a `tracers` key, so every other step's context
  # is exactly the shape it has always been.
  if step_is_exclusive "$step"; then
    ctx=$(printf '%s' "$ctx" | jq --arg t "$tracers" \
      '. + {tracers: (if $t == "" then null else ($t / ",") end)}')
  fi

  printf '%s\n' "$ctx"
}
