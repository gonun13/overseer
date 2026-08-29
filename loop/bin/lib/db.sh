#!/usr/bin/env bash
# File-database helpers for loop/*. Path/IO layer only — no CLI-invocation
# knowledge lives here, and no control flow: nothing in this file decides what
# the loop does next. Requires common.sh to already be sourced (LOOP_DIR).

# It sources lib/git.sh, which is the workspace repo's version-control layer:
# `commit` and `review` carry frontmatter values bash derives from git the same
# way it derives a `*_ref` from a path (see column 11 below), so the same
# compare-don't-count rule can cover them.
# shellcheck source=./git.sh
. "$LOOP_LIB_DIR/git.sh"

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
#   9 enum_keys       further required keys constrained to a fixed set of
#                     values, written `key:v1,v2,...` — the row separator is
#                     '|', so the value set is comma-separated. Bash validating
#                     these is what stops `record` committing a routing
#                     decision the overseer would then have no way to act on.
#  10 opt_ref_steps   steps handed over as `inputs.<step>_file` *when they
#                     exist* — no frontmatter key, no existence check. Same
#                     treatment as memory.md: available if there, never a
#                     precondition. This is how a `decide` directive reaches
#                     the next `implement` run without making the first one
#                     impossible to start.
#  11 git_keys        further required keys whose values bash derives from the
#                     *workspace's* git repo rather than from db/, resolved
#                     through lib/git.sh. Consulted only for a step whose row
#                     names one, so every other step still validates in a
#                     workspace whose directory has gone. Unlike the timestamp
#                     these are compared for equality, not shape: they are
#                     written into the workspace's .git/config when the request
#                     takes the working tree and read back unchanged, so bash
#                     still holds the exact value when `record` runs.
#  12 model_hint      the model a subagent running this step should be spawned
#                     on, surfaced as `model` in the step context. Empty — the
#                     usual case — means "inherit whatever the session is on",
#                     which is what every step that has to explore or judge
#                     wants. It is named only for a step that reads a fixed set
#                     of inputs and writes a fixed shape from them, where a
#                     smaller model is not a downgrade. Advisory in both
#                     directions: whoever spawns may not be able to honour it,
#                     and must fall back to the session default if the named
#                     model is unavailable, so nothing here is ever validated
#                     against a written record.
LOOP_STEPS=(
  "raw|raw|txt|||||||||"
  "signoff|signoff|txt|||||||||"
  "request|requests|md|requested|submitted_at|raw|||kind:feature,fix,change,epic|||haiku"
  "research|research|md|researched|researched_at|request||||||"
  "scope|scope|md|scoped|scoped_at|request research|questions_asked|||||"
  "plan|plan|md|planned|planned_at|request research scope||impact phase_count||||"
  "implement|implement|md|implemented|implemented_at|scope plan|tracers|||decide||"
  "verify|verify|md|verified|verified_at|scope plan implement|checks_run||verdict:pass,fail,blocked|||"
  "decide|decide|md|decided|decided_at|plan implement verify||decisions|route:implement,rework,plan,scope,commit|||"
  "commit|commit|md|committed|committed_at|request implement decide|pr_title||||branch base_branch|haiku"
  "review|review|md|reviewed|reviewed_at|request scope commit signoff|findings||outcome:approved,followups,rejected||branch base_branch|"
)

# `signoff` carries no done_status for the same reason `raw` does not: it is the
# human's own words, not an agent-written artifact, so nothing validates or
# records it and `step_names` skips it. The row still earns its place — paths,
# `ensure_slug_dirs`, `artifact_ref` and `clear`'s deletion list all derive from
# it, and `review` names it as a required ref, which is what makes the human's
# sign-off a precondition of the review record rather than an afterthought.

# A step's ref_steps are what it actually reads, not everything before it: each
# ref is one more frontmatter value a step can mis-copy into a rejected record,
# and nothing is lost, because every earlier artifact stays reachable by
# following the chain (verify_ref -> implement_ref -> plan_ref -> scope_ref).
#
# `implement` is the sharpest case, and the reason the rule is worth stating
# twice. It used to name `request research scope plan`, which handed every run
# the whole history: the raw ask, the exploration of the codebase, the bounds,
# and the decomposition. But by the time it runs, the plan *is* the distillation
# of the first two — that is what `plan` was for — so research and the request
# record were ~1.3K tokens of restatement in front of every implement subagent,
# on every lap. It now names `scope plan`: the authority on what is in bounds,
# and the authority on how. Both remain reachable through plan_ref for the run
# that genuinely needs them.

# --- Plan parallelism advice ----------------------------------------------
#
# `plan` declares which tracers of a phase may be built in one `implement`
# run, and `loop/bin/tracers --next` hands out exactly what it declared. A
# tracer that owns files nobody else in its phase touches costs nothing to
# group, so a phase that serializes disjoint tracers turns one lap of
# implement -> verify -> decide into N laps of it, at no benefit — the most
# expensive mistake a plan can make, and an invisible one, because every
# individual record still looks right.
#
# So `record` says so. This is advice, on stderr, and never a refusal: the
# owned-path sets are prose written by a model, and a heuristic reading of
# prose must not be able to block a plan from being recorded. A false
# positive costs the reader one line; a false refusal would cost them the
# step. When the tracers really do share a path, the plan says so and this
# stays quiet.
#
# plan_parallelism_warn <plan-file> — always returns 0.
plan_parallelism_warn() {
  local file=$1
  [ -f "$file" ] || return 0

  awk '
    # Owned paths, as a set. Backticked spans first — that is the template
    # shape — falling back to comma-separated tokens that look like paths, so
    # a plan that wrote them bare is still read rather than silently skipped.
    function paths(s,   out, n, i, tok, arr) {
      out = ""
      n = split(s, arr, "`")
      if (n >= 3) {
        for (i = 2; i < n; i += 2) if (arr[i] != "") out = out arr[i] "\n"
        return out
      }
      n = split(s, arr, ",")
      for (i = 1; i <= n; i++) {
        tok = arr[i]
        gsub(/^[ \t]+|[ \t]+$/, "", tok)
        if (tok ~ /[\/.]/ && tok !~ / /) out = out tok "\n"
      }
      return out
    }
    function disjoint(a, b,   na, nb, i, j, x, y) {
      na = split(a, x, "\n"); nb = split(b, y, "\n")
      for (i = 1; i <= na; i++) {
        if (x[i] == "") continue
        for (j = 1; j <= nb; j++) {
          if (y[j] == "") continue
          # Prefix either way, so `app/` and `app/pages/index.vue` collide.
          if (x[i] == y[j] || index(x[i], y[j]) == 1 || index(y[j], x[i]) == 1) return 0
        }
      }
      return 1
    }

    /^### Phase/          { phase = $0; sub(/^### +/, "", phase); n = 0; delete id; delete fl; delete par; started = 1 }
    /^#### Tracer/        { if (!started) next
                            t = $0; gsub(/^[^`]*`|`.*$/, "", t); n++; id[n] = t; fl[n] = ""; par[n] = "" }
    /^- *Files\/areas:/   { if (n) { s = $0; sub(/^- *Files\/areas: */, "", s); fl[n] = paths(s) } }
    /^- *Parallel:/       { if (n) { s = $0; sub(/^- *Parallel: */, "", s); gsub(/[ \t]+$/, "", s); par[n] = s } }

    # A phase ends where the next one begins, or at the section after the
    # last. Evaluate there, so `## Out of Plan` does not swallow phase N.
    /^## /                { if (started) { flush(); started = 0 } }
    END                   { if (started) flush() }

    function flush(   i, j, allseq, ok) {
      if (n < 2) { n = 0; return }
      allseq = 1
      for (i = 1; i <= n; i++) if (par[i] ~ /true/) allseq = 0
      if (!allseq) { n = 0; return }
      ok = 1
      for (i = 1; i <= n && ok; i++)
        for (j = i + 1; j <= n && ok; j++)
          if (!disjoint(fl[i], fl[j])) ok = 0
      if (ok) {
        printf "plan advice: %s serializes %d tracers that own disjoint files\n", phase, n > "/dev/stderr"
        for (i = 1; i <= n; i++) printf "  %s — Parallel: false\n", id[i] > "/dev/stderr"
        print  "  Nothing in the files forces the order, so this is N laps of implement -> verify -> decide" > "/dev/stderr"
        print  "  where one would do. If the order is real, name the shared path; otherwise mark them parallel." > "/dev/stderr"
      }
      n = 0
    }
  ' "$file"
  return 0
}

# --- The stint ---------------------------------------------------------------
#
# Steps that take the workspace's working tree. One request may hold it at a
# time: two of them editing the same tree is exactly the conflict this prevents.
# It is claimed by `loop/bin/step` and, unlike the session lease, deliberately
# outlives the session — a restarted overseer must find the request still
# holding it.
#
# The order is the order they run in. `decide` does not release the lock — it
# clears the claim's recorded marks so the cycle can turn again (see
# impl_lock_clear_marks) — so the holder keeps the working tree until the work
# is committed. `commit` is the last of them and the one that ends the stint,
# though it is `loop/bin/land` that actually releases it: `record` writing a
# commit artifact does not move the repo, and letting another request in before
# the changes are committed would put its branch on top of a tree still full of
# uncommitted work. `loop/bin/stint --release` and `loop/bin/clear` remain the
# administrative ways out.
#
# `review` is deliberately NOT here. It reads a throwaway worktree at the
# request's own branch, never the main tree, so a request under review must not
# block the next one from entering — that is the whole point of releasing at
# commit.
LOOP_EXCLUSIVE_STEPS="implement verify decide commit"

# step_is_exclusive <step> — 0 if that step takes the working tree.
step_is_exclusive() {
  case " $LOOP_EXCLUSIVE_STEPS " in
    *" $1 "*) return 0 ;;
  esac
  return 1
}

# next_exclusive_step <step> — the step that follows it inside the stint.
# Prints nothing for `commit`, because nothing follows it: the stint ends there
# rather than being handed on. (It used to print the literal string `commit`
# here, back when `commit` was outside the list and unbuilt. Leaving that in
# once `commit` joined the list would have made next_exclusive_step commit
# answer "commit" — and `loop/bin/step` say "commit has already recorded;
# commit is what comes next".) Prints nothing for a step that is not exclusive.
next_exclusive_step() {
  local step=$1 s take=0
  for s in $LOOP_EXCLUSIVE_STEPS; do
    if [ "$take" -eq 1 ]; then
      printf '%s' "$s"
      return 0
    fi
    [ "$s" = "$step" ] && take=1
  done
  return 0
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
# The stint (see LOOP_EXCLUSIVE_STEPS) — not a mutex, a holder
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
  # A missing file is a legitimate question with an empty answer — `list` asks
  # about records a `clear` has already deleted — so it is not an error and
  # must not leak awk's complaint to stderr.
  [ -f "$file" ] || return 0
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
  [ -f "$file" ] || return 0
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

# record_section <file> <heading> — the body of one `## <heading>` section of a
# record, up to the next heading of the same or a higher level. Blank when the
# section is absent or empty.
#
# This is how `loop/bin/land` gets the commit message and the pull-request body
# out of a commit record. It lives here beside plan_tracers and ledger_statuses
# for the same reason they do: markdown parsing belongs in one file, so nothing
# else in the tool grows a private idea of what an artifact looks like.
record_section() {
  local file=$1 heading=$2
  [ -f "$file" ] || return 0
  awk -v want="## $heading" '
    $0 == want { inside = 1; next }
    inside && /^#{1,2}[[:space:]]/ { inside = 0 }
    inside { print }
  ' "$file" | sed -e '/./,$!d' | awk '
    { lines[NR] = $0 }
    END {
      last = NR
      while (last > 0 && lines[last] ~ /^[[:space:]]*$/) last--
      for (i = 1; i <= last; i++) print lines[i]
    }
  '
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

  # Values bash derives from the workspace's git repo rather than from db/.
  # Resolved only for a step whose row names one, so a step with no git_keys
  # never touches git and still validates in a workspace whose directory has
  # been removed — which is what lets `clear` tidy up after a deleted project.
  local git_keys key repo
  git_keys=$(step_field "$step" 11)
  if [ -n "$git_keys" ]; then
    repo=$(resolve_workspace "$workspace")
    for key in $git_keys; do
      printf '%s\t%s\n' "$key" "$(git_derived_value "$repo" "$id" "$key")"
    done
  fi
}

# require_git_keys <workspace> <id> <step> — resolve every git-derived key this
# step declares, discarding the values, purely so a failure to resolve one is
# fatal *here*.
#
# expected_frontmatter is always read through a command or process
# substitution, and `die` in a subshell ends only that subshell — the caller
# carries on with a key missing or empty. An empty expectation compared against
# an empty write passes, which is precisely the presence-only hole the
# compare-don't-count rule exists to close. So callers resolve the keys in
# their own shell first, where dying actually stops them.
require_git_keys() {
  local workspace=$1 id=$2 step=$3 git_keys key repo
  git_keys=$(step_field "$step" 11)
  [ -n "$git_keys" ] || return 0
  repo=$(resolve_workspace "$workspace")
  for key in $git_keys; do
    git_derived_value "$repo" "$id" "$key" >/dev/null
  done
}

# open_frontmatter <step> — the required keys whose values bash cannot predict,
# one `key<TAB>constraint` line each. The step itself must supply them.
open_frontmatter() {
  local step=$1 key spec
  for key in $(step_field "$step" 7); do
    printf '%s\ttext\n' "$key"
  done
  for key in $(step_field "$step" 8); do
    printf '%s\tinteger >= 1\n' "$key"
  done
  # An enum's allowed values are handed over with the key, so a step is told
  # the set it will be judged against rather than having to guess it.
  for spec in $(step_field "$step" 9); do
    key=${spec%%:*}
    printf '%s\tone of: %s\n' "$key" "$(printf '%s' "${spec#*:}" | tr ',' ' ' | sed 's/ /, /g')"
  done
}

# enum_allows <spec> <value> — 0 if <value> is in the `key:v1,v2` spec's set.
enum_allows() {
  case ",${1#*:}," in
    *",$2,"*) return 0 ;;
  esac
  return 1
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
  local file at_key key spec want got ok=0
  file=$(artifact_path "$slug" "$step" "$id")
  at_key=$(step_field "$step" 5)
  require_git_keys "$workspace" "$id" "$step"

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

  for spec in $(step_field "$step" 9); do
    key=${spec%%:*}
    got=$(record_frontmatter_get "$file" "$key")
    enum_allows "$spec" "$got" && continue
    [ "$ok" -eq 0 ] && printf '%s: frontmatter is not valid\n' "$file" >&2
    ok=1
    printf '  %-14s expected one of %-40s got %s\n' \
      "$key:" "$(printf '%s' "${spec#*:}" | tr ',' ' ' | sed 's/ /, /g')" "${got:-<empty>}" >&2
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

# --- The stint -----------------------------------------------------------
#
# db/<slug>/implement.lock is two lines of plain text — no JSON, no pid, so
# nothing here needs jq and, unlike the session lease, there is no holder
# process to reap:
#
#   1. the id of the request that owns the workspace's working tree
#   2. the exclusive steps that have already *recorded* under this claim
#
# loop/bin/step claims it; nothing in the loop drops it, so a request holds the
# working tree across overseer restarts until its work is committed.
# loop/bin/stint --release and loop/bin/clear are the administrative ways out.
#
# Line 2 is what keeps the stint's steps in order and stops a request building
# on its own unjudged work: once `implement` has recorded under this claim, the
# next thing that may run is `verify`, then `decide`. `decide` then clears the
# line (impl_lock_clear_marks), which is what lets the same request take
# another lap. It is scoped to the claim rather than derived from the request's
# status precisely so that a run whose `record` failed — nothing recorded, so
# nothing marked — can still be retried.

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

# impl_lock_clear_marks <slug> — wipe line 2, keeping the holder. This is how
# `decide` turns the cycle: implement -> verify -> decide have each recorded
# under this claim, and clearing their marks lets the same request run them
# again on the next lap without ever letting go of the working tree. The
# holder is untouched on purpose — a request owns the tree from its first
# `implement` until the work is committed, not until it has been judged once.
impl_lock_clear_marks() {
  local slug=$1 lock path id
  lock=$(lock_path "$slug")
  path=$(impl_lock_path "$slug")
  (
    flock -x 9
    [ -f "$path" ] || exit 0
    id=$(sed -n 1p "$path")
    [ -n "$id" ] || exit 0
    printf '%s\n' "$id" > "$path"
  ) 9>>"$lock"
}

# _impl_lock_release <slug> — raw, unlocked removal. Callers must already hold
# the slug's flock (see impl_lock_release and clear_request below) — this never
# locks itself, so it must never be called outside one.
_impl_lock_release() {
  rm -f "$(impl_lock_path "$1")"
}

# impl_lock_claim <slug> <id> — take the stint for that request.
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

# impl_lock_release <slug> — drop the lock, whoever holds it. Called by
# loop/bin/land once the work is actually committed and pushed, which is the
# normal end of the stint, and by loop/bin/stint --release, which is the hatch
# for a human cleaning up outside a session.
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
# and must outlive any single request's clear. The stint IS
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

  # Resolve the git-derived keys before building anything, so a step whose
  # branch or pull request is missing is refused outright rather than handed a
  # context with an empty value in it.
  require_git_keys "$workspace" "$id" "$step"

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

  # Optional refs get the same treatment: handed over when they exist, silently
  # absent when they do not. They carry no frontmatter key, so a step is never
  # blocked from starting by an artifact a later step writes — which is exactly
  # the case for `decide`, whose directive an `implement` rerun needs but whose
  # first run necessarily precedes.
  for ref_step in $(step_field "$step" 10); do
    file=$(artifact_path "$slug" "$ref_step" "$id")
    [ -f "$file" ] || continue
    inputs=$(jq -c --argjson acc "$inputs" --arg k "${ref_step}_file" --arg v "$file" \
      -n '$acc + {($k): $v}')
  done

  while IFS=$'\t' read -r key val; do
    front=$(jq -c --argjson acc "$front" --arg k "$key" --arg v "$val" -n '$acc + {($k): $v}')
  done < <(expected_frontmatter "$slug" "$workspace" "$id" "$step" "$at")

  while IFS=$'\t' read -r key val; do
    open=$(jq -c --argjson acc "$open" --arg k "$key" --arg v "$val" -n '$acc + {($k): $v}')
  done < <(open_frontmatter "$step")

  # `model` is advisory and always present, null where the row names nothing.
  # Present-but-null rather than absent so whoever reads the context never has
  # to distinguish "this step has no hint" from "this bash is too old to emit
  # one" — both mean the same thing, and both mean the session default.
  ctx=$(jq -n \
    --arg step "$step" \
    --arg id "$id" \
    --arg workspace "$workspace" \
    --arg slug "$slug" \
    --arg workspace_dir "$workspace_dir" \
    --arg instructions "$LOOP_DIR/steps/$step.md" \
    --arg output_file "$(artifact_path "$slug" "$step" "$id")" \
    --arg model "$(step_field "$step" 12)" \
    --argjson inputs "$inputs" \
    --argjson frontmatter "$front" \
    --argjson frontmatter_open "$open" \
    '{step:$step, id:$id, workspace:$workspace, slug:$slug,
      workspace_dir:$workspace_dir, instructions:$instructions,
      model:(if $model == "" then null else $model end),
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
