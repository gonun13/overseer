#!/usr/bin/env sh
# Guard for the root npm scripts. OVERSEER_IN_CONTAINER is set only by the
# Dockerfile `dev` stage, so this fails on the host no matter what is installed
# there — having Node 22 available is not permission to use it.
set -eu

if [ "${OVERSEER_IN_CONTAINER:-}" = "1" ]; then
  exit 0
fi

cat >&2 <<'EOF'
overseer: refusing to run outside the container.

  This project never runs on the host, dev included. The server spawns coding
  agents with filesystem and network access; the sandbox is the whole point of
  the design (docs/claude-code-webui-design.md §6), and a host run puts your
  real ~/.claude and home directory inside the blast radius.

  Use instead:
    ./bin/dev            start the dev stack (web :5173, server :3000)
    ./bin/sh             shell into the dev container
    ./bin/npm <args>     run npm inside the container

EOF
exit 1
