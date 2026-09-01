#!/usr/bin/env sh
# Shared setup for the bin/ scripts. Not meant to be run directly.
set -eu

REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export REPO_ROOT
cd "$REPO_ROOT"

# The image builds a user at the caller's uid/gid. Without this, containers run
# as 1000 and cannot write ./workspace or ./loop on any host whose user is not
# 1000 — and git refuses a bind-mounted repo it sees as dubiously owned. Every
# compose file reads these as build args, defaulting to 1000 for a bare
# `docker compose` call, which bin/ is the supported alternative to.
OVERSEER_UID=$(id -u)
OVERSEER_GID=$(id -g)
export OVERSEER_UID OVERSEER_GID

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
