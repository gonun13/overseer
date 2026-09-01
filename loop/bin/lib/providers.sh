#!/usr/bin/env bash
# Provider resolution/loading. Mirrors the shape of Overseer's own
# AgentAdapter split (packages/protocol/src/adapter.ts): an id string plus a
# small function contract each provider implements — here just two functions,
# because a provider's whole job is to open one interactive session. Requires
# common.sh to already be sourced (REPO_ROOT, LOOP_DIR, die, require_cmd).
#
# Bundles live in the shared registry at providers/<id>/, a sibling of
# packages/ and loop/, so the app and the loop read one declaration of what a
# provider is. Each directory carries manifest.json, and — for a provider the
# loop can actually run — provider.sh plus that provider's own config tree.
# The manifest's `loop` field says which: "bundle" means runnable here,
# "none" means the app knows about it but the loop does not. Orchestration
# never references a specific CLI or config layout.
#
# Contract inputs, beyond provider_session's two arguments:
#   LOOP_SESSION_ID  the session id this run should open under, already in the
#                    lease. A bundle whose CLI accepts one maps it onto the
#                    right flag; a bundle whose CLI does not simply ignores it,
#                    and readers see a lease with a null session_id. Stated as
#                    an environment variable rather than a third argument so
#                    adding it did not change the contract's arity.

# PROVIDERS_DIR — stated by the environment in the container (the image owns
# where code lives), derived from the repo layout otherwise.
PROVIDERS_DIR="${OVERSEER_PROVIDERS_DIR:-$REPO_ROOT/providers}"
export PROVIDERS_DIR

# manifest_path <id>
manifest_path() {
  printf '%s/%s/manifest.json' "$PROVIDERS_DIR" "$1"
}

# manifest_field <id> <key> — the value as a string, empty when absent or null.
manifest_field() {
  local f
  f=$(manifest_path "$1")
  [ -f "$f" ] || return 1
  jq -r --arg k "$2" '.[$k] // empty' "$f" 2>/dev/null
}

# is_loop_bundle <id> — the manifest claims the loop can run it, and the two
# files that claim requires are actually there.
is_loop_bundle() {
  local id=$1 root="$PROVIDERS_DIR/$1"
  [ -f "$root/manifest.json" ] || return 1
  [ -f "$root/provider.sh" ] || return 1
  [ "$(manifest_field "$id" loop)" = "bundle" ]
}

# resolve_provider_id — env override > local .provider file > fallback.
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

# list_provider_ids — one id per line for every bundle the loop can run.
# Providers the registry carries for the app alone are deliberately not listed:
# selecting one here could only ever fail.
list_provider_ids() {
  require_cmd jq
  local d id
  while IFS= read -r d; do
    id=$(basename "$d")
    is_loop_bundle "$id" || continue
    printf '%s\n' "$id"
  done < <(find "$PROVIDERS_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort)
}

# list_provider_bundles — prints "  - <id>" lines for every runnable bundle.
list_provider_bundles() {
  local id
  while IFS= read -r id; do
    printf '  - %s\n' "$id"
  done < <(list_provider_ids)
}

# set_provider_id <id> — writes loop/.provider after validating the bundle
# exists. Does not require the provider CLI to be on PATH (selection is
# config; availability is checked at load_provider time).
set_provider_id() {
  require_cmd jq
  local id=$1
  if ! is_loop_bundle "$id"; then
    local available
    available=$(list_provider_bundles)
    [ -n "$available" ] || available="  (none the loop can run, under $PROVIDERS_DIR)"
    die "unknown provider '$id'
Available providers:
$available" 1
  fi
  printf '%s\n' "$id" > "$LOOP_DIR/.provider"
}

# load_provider — reads providers/<id>/manifest.json, sources provider.sh,
# asserts the contract, and checks the provider is available. Sets
# PROVIDER_ID, PROVIDER_CLI, PROVIDER_CONFIG_DIR, PROVIDER_ROOT and
# PROVIDER_CONFIG_ROOT on success.
load_provider() {
  require_cmd jq
  local id root script manifest
  id=$(resolve_provider_id)
  root="$PROVIDERS_DIR/$id"
  script="$root/provider.sh"
  manifest="$root/manifest.json"

  if [ ! -f "$manifest" ] || [ ! -f "$script" ]; then
    local available
    available=$(list_provider_bundles)
    [ -n "$available" ] || available="  (none the loop can run, under $PROVIDERS_DIR)"
    die "unknown provider '$id' — need $manifest and $script
Available providers:
$available" 1
  fi

  jq -e . "$manifest" >/dev/null 2>&1 || die "provider '$id' manifest is not valid JSON ($manifest)" 1

  PROVIDER_ID=$(manifest_field "$id" id)
  PROVIDER_CLI=$(manifest_field "$id" cli)
  PROVIDER_CONFIG_DIR=$(manifest_field "$id" configDir)

  if [ -z "$PROVIDER_ID" ] || [ -z "$PROVIDER_CONFIG_DIR" ]; then
    die "provider '$id' manifest must set 'id' and 'configDir' ($manifest)" 1
  fi
  if [ "$PROVIDER_ID" != "$id" ]; then
    die "provider '$id' manifest id='$PROVIDER_ID' does not match bundle dir name" 1
  fi
  if [ "$(manifest_field "$id" loop)" != "bundle" ]; then
    die "provider '$id' is in the registry for the app only (loop: $(manifest_field "$id" loop)) — the loop cannot run it" 1
  fi

  PROVIDER_ROOT=$root
  PROVIDER_CONFIG_ROOT="$PROVIDER_ROOT/$PROVIDER_CONFIG_DIR"
  export PROVIDER_ID PROVIDER_ROOT PROVIDER_CONFIG_ROOT PROVIDER_CONFIG_DIR
  # Optional manifest field — export if set so provider.sh can use it.
  [ -n "$PROVIDER_CLI" ] && export PROVIDER_CLI

  # shellcheck disable=SC1090
  source "$script"

  local fn
  for fn in provider_check_available provider_session; do
    declare -F "$fn" >/dev/null || die "provider '$id' is missing function '$fn' ($script)" 1
  done

  provider_check_available || die "provider '$id' is not available (see message above)" 1
}
