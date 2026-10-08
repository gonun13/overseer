#!/usr/bin/env sh
# Shared setup for the bin/ scripts. Not meant to be run directly.
set -eu

REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export REPO_ROOT
cd "$REPO_ROOT"

# The image builds a user at the caller's uid/gid. Without this, containers run
# as 1000 and cannot write the workspace or ./loop on any host whose user is not
# 1000 — and git refuses a bind-mounted repo it sees as dubiously owned. Every
# compose file reads these as build args, defaulting to 1000 for a bare
# `docker compose` call, which bin/ is the supported alternative to.
OVERSEER_UID=$(id -u)
OVERSEER_GID=$(id -g)
export OVERSEER_UID OVERSEER_GID

# The workspace used to live at $REPO_ROOT/workspace. Refuse to start while a
# non-empty one is still there rather than mounting the new location and letting
# discovery scaffold a fresh overseer-personality into it — that boots an empty
# world and reads as "every project is gone" when nothing has been lost.
# Delete this guard once 0.3.4 is far enough back that no one upgrades across it.
if [ -d "$REPO_ROOT/workspace" ] && [ -n "$(ls -A "$REPO_ROOT/workspace" 2>/dev/null)" ]; then
  echo "overseer: the workspace has moved out of the repo." >&2
  echo "  Your projects are still in ./workspace — nothing has been lost." >&2
  echo "  Move them, then re-run:" >&2
  echo >&2
  echo "    mv workspace ../overseer-workspace" >&2
  echo >&2
  exit 1
fi

# The host side of the /workspace bind. Outside the repo by design: nesting it
# made every project visible twice in dev (as /workspace/x and /app/workspace/x),
# and the second name fails the containment check in packages/server/src/workspace.ts.
#
# Precedence, highest first: the shell environment, then .env, then the sibling
# default. Compose reads .env on its own but ranks it *below* the environment, so
# without this the export below would silently beat an operator's own setting.
# Only this one key is read — bin/ does not source an operator's .env wholesale.
if [ -z "${OVERSEER_WORKSPACE_HOST:-}" ] && [ -f "$REPO_ROOT/.env" ]; then
  OVERSEER_WORKSPACE_HOST=$(sed -n 's/^[[:space:]]*OVERSEER_WORKSPACE_HOST=//p' "$REPO_ROOT/.env" | tail -n 1)
fi
OVERSEER_WORKSPACE_HOST="${OVERSEER_WORKSPACE_HOST:-$REPO_ROOT/../overseer-workspace}"

if [ -e "$OVERSEER_WORKSPACE_HOST" ] && [ ! -d "$OVERSEER_WORKSPACE_HOST" ]; then
  echo "overseer: OVERSEER_WORKSPACE_HOST is not a directory: $OVERSEER_WORKSPACE_HOST" >&2
  exit 1
fi
# Nothing else creates the bind source now that no mount point is committed, and
# a directory Docker autocreates is root-owned — which is exactly what the
# uid/gid matching above exists to avoid.
mkdir -p "$OVERSEER_WORKSPACE_HOST"
# Absolute, so the value does not depend on compose's project directory. The
# compose files repeat the ../overseer-workspace default for a bare
# `docker compose` call, which bin/ is the supported alternative to.
OVERSEER_WORKSPACE_HOST=$(CDPATH= cd -- "$OVERSEER_WORKSPACE_HOST" && pwd)
export OVERSEER_WORKSPACE_HOST

# Git's four identity variables are read ahead of every config file, so an
# empty one is worse than an absent one: it beats the identity the operator
# saved in settings *and* the container's own ~/.gitconfig, and the only thing
# it can produce is `fatal: empty ident name (for <>)`. The compose files pass
# these through by bare name, which leaves an unset variable unset — but a
# shell or .env that exports one as empty would hand the emptiness straight on.
# Nobody means an empty identity, so treat it as the "unset" it was meant to be.
for _ident in GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL; do
  eval "_value=\${$_ident:-}"
  # if/fi rather than `[ … ] && unset`: under `set -e` a failed test as the
  # last command in the loop body would exit the script on the first variable
  # that *is* set.
  if [ -z "$_value" ]; then
    unset "$_ident"
  fi
done
unset _ident _value

DEV_COMPOSE="docker-compose.dev.yml"
PROD_COMPOSE="docker-compose.yml"
export DEV_COMPOSE PROD_COMPOSE

# Optional, gitignored, one per stack: the operator's own additions, merged over
# the stack's file. The case they exist for is a name that means the host —
# `extra_hosts: ["gitlab.local:host-gateway"]` for a self-hosted forge whose
# remotes say gitlab.local while the host's /etc/hosts says 127.0.0.1, which in
# here is the container itself (spec/architecture.md §6.4). One file per stack
# rather than one shared, because the app service is `overseer` in one and
# `server` in the other, and naming a service a stack lacks is a compose error.
# Compose's own docker-compose.override.yml never loads: every call names -f.
DEV_COMPOSE_LOCAL="docker-compose.dev.local.yml"
PROD_COMPOSE_LOCAL="docker-compose.local.yml"

# _compose <stack file> <local file> <args…>
_compose() {
  _stack=$1 _local=$2
  shift 2
  if [ -f "$_local" ]; then
    docker compose -f "$_stack" -f "$_local" "$@"
  else
    docker compose -f "$_stack" "$@"
  fi
}

dev_compose() {
  _compose "$DEV_COMPOSE" "$DEV_COMPOSE_LOCAL" "$@"
}

prod_compose() {
  _compose "$PROD_COMPOSE" "$PROD_COMPOSE_LOCAL" "$@"
}

require_docker() {
  if ! docker info >/dev/null 2>&1; then
    echo "overseer: Docker is not running." >&2
    echo "  This project has no host-side run path. Start Docker Desktop and retry." >&2
    exit 1
  fi
}
