#!/usr/bin/env bash
# Provider resolution/loading. Mirrors the shape of Overseer's own
# AgentAdapter split (packages/protocol/src/adapter.ts): an id string plus a
# small function contract each provider implements. Requires common.sh to
# already be sourced (LOOP_DIR, die, require_cmd).

# resolve_provider_id — env override > tracked .provider file > fallback.
resolve_provider_id() {
  if [ -n "${LOOP_PROVIDER:-}" ]; then
    printf '%s' "$LOOP_PROVIDER"
    return
  fi

  local f="$LOOP_DIR/.provider"
  if [ -f "$f" ]; then
    local v
    v=$(tr -d '[:space:]' < "$f")
    if [ -n "$v" ]; then
      printf '%s' "$v"
      return
    fi
  fi

  printf 'claude-code'
}

# load_provider — sources lib/providers/<id>.sh, asserts it implements the
# contract, and checks its CLI is available. Sets PROVIDER_ID on success.
load_provider() {
  local id script
  id=$(resolve_provider_id)
  script="$LOOP_DIR/lib/providers/${id}.sh"

  if [ ! -f "$script" ]; then
    local available
    available=$(find "$LOOP_DIR/lib/providers" -maxdepth 1 -name '*.sh' 2>/dev/null \
      -printf '  - %f\n' | sed 's/\.sh$//' | sort)
    [ -n "$available" ] || available="  (none found under $LOOP_DIR/lib/providers)"
    die "unknown provider '$id' — no $script
Available providers:
$available" 1
  fi

  # shellcheck disable=SC1090
  source "$script"

  local fn
  for fn in provider_check_available provider_structure; do
    declare -F "$fn" >/dev/null || die "provider '$id' is missing function '$fn' ($script)" 1
  done

  provider_check_available || die "provider '$id' is not available (see message above)" 1

  PROVIDER_ID=$id
  export PROVIDER_ID
}
