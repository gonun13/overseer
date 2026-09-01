#!/usr/bin/env bash
# Shared helpers for loop/* scripts. Not meant to be run directly.

# LOOP_LIB_DIR   loop/bin/lib   — this file's own directory
# LOOP_BIN_DIR   loop/bin       — implementation root (scripts + lib/)
# LOOP_DIR       loop/          — tool data/config root (db/, .provider)
# REPO_ROOT      loop/..        — parent of both loop/ and the shared providers/
LOOP_LIB_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
LOOP_BIN_DIR="$(CDPATH='' cd -- "$LOOP_LIB_DIR/.." && pwd)"
LOOP_DIR="$(CDPATH='' cd -- "$LOOP_BIN_DIR/.." && pwd)"
REPO_ROOT="$(CDPATH='' cd -- "$LOOP_DIR/.." && pwd)"
# The app states this in the container (packages/server/src/workspace.ts reads
# the same variable), so both sides resolve a project to one path. Derived from
# the repo layout when it is unset, which is how the loop used to find it.
WORKSPACE_ROOT="${OVERSEER_WORKSPACE:-$REPO_ROOT/workspace}"
export LOOP_LIB_DIR LOOP_BIN_DIR LOOP_DIR REPO_ROOT WORKSPACE_ROOT

log_info() { printf 'loop: %s\n' "$*" >&2; }
log_error() { printf 'loop: %s\n' "$*" >&2; }

# die <message> [exit-code]
die() {
  local msg=$1 code=${2:-1}
  log_error "$msg"
  exit "$code"
}

# require_cmd <name> — fail fast with a clear message if a binary isn't on PATH.
require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found on PATH: $1"
}

# slugify <name> — mirrors packages/adapters/claude-code/src/project-slug.ts:
# a lossy 1:1 replace of every non-alphanumeric char with '-', no run-collapsing.
slugify() {
  printf '%s' "$1" | sed -E 's/[^A-Za-z0-9]/-/g'
}

# validate_workspace_name <name> — charset check only, no existence check.
# Split out of resolve_workspace so tools that operate on db/ records (list,
# clear) can validate a name without requiring workspace/<name> to still
# exist — e.g. clearing requests left behind after a workspace was removed.
validate_workspace_name() {
  local name=$1
  if [ -z "$name" ] || ! [[ "$name" =~ ^[A-Za-z0-9._-]+$ ]]; then
    die "workspace name must contain only letters, digits, '.', '_', '-' (got: '$name')" 1
  fi
}

# resolve_workspace <name> — prints the absolute workspace dir on stdout, or
# dies with a helpful message (listing what does exist) if it isn't found.
resolve_workspace() {
  local name=$1
  validate_workspace_name "$name"

  local dir="$WORKSPACE_ROOT/$name"
  if [ ! -d "$dir" ]; then
    local existing
    existing=$(find "$WORKSPACE_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '  - %f\n' 2>/dev/null | sort)
    if [ -z "$existing" ]; then
      existing="  (none — $WORKSPACE_ROOT is empty)"
    fi
    die "workspace '$name' not found under $WORKSPACE_ROOT
Existing workspaces:
$existing" 2
  fi

  printf '%s' "$dir"
}

# gen_request_id — req_<UTC-compact-timestamp>_<8 hex chars>
gen_request_id() {
  printf 'req_%s_%s' "$(date -u +%Y%m%dT%H%M%SZ)" "$(random_hex 4)"
}

# random_hex <nbytes> — no uuidgen dependency, just /dev/urandom + od.
random_hex() {
  local n=${1:-4}
  od -An -N"$n" -tx1 /dev/urandom | tr -d ' \n'
}

iso_now() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}
