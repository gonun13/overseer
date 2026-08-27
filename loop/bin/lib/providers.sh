#!/usr/bin/env bash
# Provider resolution/loading. Mirrors the shape of Overseer's own
# AgentAdapter split (packages/protocol/src/adapter.ts): an id string plus a
# small function contract each provider implements. Requires common.sh to
# already be sourced (LOOP_DIR, die, require_cmd).
#
# Each provider lives as a self-contained bundle under loop/providers/<id>/
# (manifest + provider.sh + that provider's own config tree). Orchestration
# never references a specific CLI or config layout.

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

# list_provider_bundles — prints "  - <id>" lines for every bundle dir.
list_provider_bundles() {
  find "$LOOP_DIR/providers" -mindepth 1 -maxdepth 1 -type d -printf '  - %f\n' 2>/dev/null | sort
}

# load_provider — sources providers/<id>/{manifest,provider.sh}, asserts the
# contract, and checks the provider is available. Sets PROVIDER_ID,
# PROVIDER_ROOT, and PROVIDER_CONFIG_ROOT on success.
load_provider() {
  local id root script manifest
  id=$(resolve_provider_id)
  root="$LOOP_DIR/providers/$id"
  script="$root/provider.sh"
  manifest="$root/manifest"

  if [ ! -f "$script" ] || [ ! -f "$manifest" ]; then
    local available
    available=$(list_provider_bundles)
    [ -n "$available" ] || available="  (none found under $LOOP_DIR/providers)"
    die "unknown provider '$id' — need $script and $manifest
Available providers:
$available" 1
  fi

  # shellcheck disable=SC1090
  source "$manifest"

  if [ -z "${PROVIDER_ID:-}" ] || [ -z "${PROVIDER_CONFIG_DIR:-}" ]; then
    die "provider '$id' manifest must set PROVIDER_ID and PROVIDER_CONFIG_DIR ($manifest)" 1
  fi
  if [ "$PROVIDER_ID" != "$id" ]; then
    die "provider '$id' manifest PROVIDER_ID='$PROVIDER_ID' does not match bundle dir name" 1
  fi

  PROVIDER_ROOT=$root
  PROVIDER_CONFIG_ROOT="$PROVIDER_ROOT/$PROVIDER_CONFIG_DIR"
  export PROVIDER_ID PROVIDER_ROOT PROVIDER_CONFIG_ROOT
  # Optional manifest fields — export if set so provider.sh can use them.
  [ -n "${PROVIDER_CLI:-}" ] && export PROVIDER_CLI
  [ -n "${PROVIDER_COMMANDS_DIR:-}" ] && export PROVIDER_COMMANDS_DIR

  # shellcheck disable=SC1090
  source "$script"

  local fn
  for fn in provider_check_available provider_structure provider_research provider_scope; do
    declare -F "$fn" >/dev/null || die "provider '$id' is missing function '$fn' ($script)" 1
  done

  provider_check_available || die "provider '$id' is not available (see message above)" 1
}
