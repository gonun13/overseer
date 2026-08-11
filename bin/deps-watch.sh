#!/usr/bin/env bash
# bash, not sh: `wait -n` is a bashism and /bin/sh is dash on the base image.
# Runs inside the `deps` service. Builds the packages that server and web
# import through `main: ./dist/index.js`, then keeps them in tsc --watch so an
# edit to protocol/ propagates without a stack restart.
#
# The initial build must complete before server/web start — compose enforces
# that with a healthcheck on the dist/ files this produces.
set -eu

cd /app

echo "deps: initial build"
npm run build --workspace packages/protocol
npm run build --workspace packages/adapters/mock
npm run build --workspace packages/adapters/claude-code

echo "deps: watching"
npm run dev --workspace packages/protocol &
npm run dev --workspace packages/adapters/mock &
npm run dev --workspace packages/adapters/claude-code &

# Exit if any watcher dies, rather than sitting there looking healthy.
wait -n
echo "deps: a watcher exited; stopping" >&2
exit 1
