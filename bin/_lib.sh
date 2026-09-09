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
  echo "  Or keep them where they are by setting OVERSEER_WORKSPACE_HOST=./workspace" >&2
  echo "  in .env (not recommended — see docs/architecture-design.md §6.2)." >&2
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

DEV_COMPOSE="docker-compose.dev.yml"
PROD_COMPOSE="docker-compose.yml"
export DEV_COMPOSE PROD_COMPOSE

dev_compose() {
  docker compose -f "$DEV_COMPOSE" "$@"
}

prod_compose() {
  docker compose -f "$PROD_COMPOSE" "$@"
}

require_docker() {
  if ! docker info >/dev/null 2>&1; then
    echo "overseer: Docker is not running." >&2
    echo "  This project has no host-side run path. Start Docker Desktop and retry." >&2
    exit 1
  fi
}
