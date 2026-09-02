# syntax=docker/dockerfile:1

# Node and the Docker client come in as pinned artefacts, not as the base
# image. This container is an agent host, not a Node service: it carries a bash
# toolchain, git, gh, the Docker client, and several provider CLIs with three
# different runtimes between them (npm globals, a self-contained bundle with its
# own node, and whatever the next one ships). Node is one of those runtimes.
ARG NODE_IMAGE=node:24-trixie-slim
ARG DOCKER_CLI_IMAGE=docker:28-cli

FROM ${NODE_IMAGE} AS nodedist
FROM ${DOCKER_CLI_IMAGE} AS dockercli

# ---- base: the agent host — OS toolchain, node, the user, shared env --------
FROM debian:trixie-slim AS base

# git, ripgrep: the provider CLIs shell out to both.
# curl: script-based CLI installs (Cursor) and the pinned gh .deb.
# python3/make/g++: node-pty (the raw OPEN CONSOLE PTY) is a native module.
#   The runtime stage purges them again after its own `npm ci`.
# tzdata: IANA zones for TZ=… from .env, so provider CLIs format reset times in
#   the operator's zone instead of the image default (UTC).
#
# The rest are the dev loop's, not Node's — loop/bin/* is bash, and a future
# reader pruning "unused" packages would break it silently:
#   jq            required by eleven loop/bin scripts (require_cmd jq)
#   util-linux    flock — every loop db mutation serializes on it
#   findutils     GNU find; loop/bin/lib/common.sh uses -printf
#   sed, gawk     GNU sed -i and awk, throughout loop/bin
#   shellcheck    loop/bin/check; without it that script reaches for Docker
#   openssh-client  git over ssh, for a remote the loop is asked to fetch
RUN apt-get update && apt-get install -y --no-install-recommends \
      bash ca-certificates curl git ripgrep tzdata \
      jq util-linux findutils sed gawk shellcheck openssh-client procps \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Node at the pinned version, lifted whole from the official image: same
# binaries, same npm, no third-party apt repo to trust or keyring to rotate.
COPY --from=nodedist /usr/local /usr/local

# The Docker client only — the daemon is the `dind` service (compose files).
# Copied after node so it is not overwritten by the /usr/local above.
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=dockercli /usr/local/libexec/docker/cli-plugins/docker-compose \
                      /usr/local/libexec/docker/cli-plugins/docker-compose

# gh, pinned. The loop's `publish` and `close --merge` use it; the app has no
# wiring for it yet. A release .deb rather than GitHub's apt repo, for the same
# reason node comes from an image: one pinned artefact, no keyring to manage.
ARG GH_VERSION=2.98.0
RUN arch="$(dpkg --print-architecture)" \
    && curl -fsSL -o /tmp/gh.deb \
         "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${arch}.deb" \
    && dpkg -i /tmp/gh.deb \
    && rm -f /tmp/gh.deb \
    && gh --version

# The user runs as the host's uid so bind mounts are writable and git does not
# refuse the workspace as dubiously owned. ./bin/_lib.sh fills these from
# `id -u` / `id -g`; a bare `docker compose` gets the 1000 default.
#
# A host GID this common (e.g. 20 — macOS's default "staff" group) can already
# belong to a system group in the base image (Debian's "dialout" owns 20).
# Downstream `chown -R overseer:overseer` needs that name to resolve, so an
# existing claimant is renamed rather than left in place with the GID we want.
ARG OVERSEER_UID=1000
ARG OVERSEER_GID=1000
RUN if getent group "$OVERSEER_GID" >/dev/null; then \
      groupmod -n overseer "$(getent group "$OVERSEER_GID" | cut -d: -f1)"; \
    else \
      groupadd -g "$OVERSEER_GID" overseer; \
    fi \
    && useradd -u "$OVERSEER_UID" -g "$OVERSEER_GID" -m -d /home/overseer -s /bin/bash overseer

WORKDIR /app

# Where things live, stated by the image rather than inferred at runtime — the
# same reasoning CLAUDE_CONFIG_DIR has always carried here: a path is a
# deployment fact, and both the server and loop/bin/* read these.
#
#   /app              code: packages/, loop/, providers/
#   /home/overseer    every provider CLI's config and auth — the agent-home volume
#   /workspace        the one surface shared with the host
#   /app/.overseer    internal memory (docs/overseer.md §6.2)
#   /app/loop/db      the dev loop's file store
#
# NOTHING THAT AN IMAGE REBUILD MUST BE ABLE TO REPLACE MAY LIVE UNDER
# /home/overseer. A named volume mounts there and shadows the image's copy from
# the first mount onward, so anything baked in is frozen. That is why the Cursor
# bundle below goes to /opt and is symlinked onto PATH, rather than staying
# where its installer puts it.
ENV CLAUDE_CONFIG_DIR=/home/overseer/.claude
ENV OVERSEER_WORKSPACE=/workspace
ENV OVERSEER_PROVIDERS_DIR=/app/providers
ENV OVERSEER_INTERNAL_DIR=/app/.overseer
# Read by bin/_in-container.sh and by loop/run — the only thing that
# distinguishes a sanctioned run from someone typing the command on the host.
ENV OVERSEER_IN_CONTAINER=1
# CLIs are pinned in the image and run as non-root; auto-update cannot write the
# global npm prefix and would only noise an interactive TUI.
ENV DISABLE_AUTOUPDATER=1
ENV DISABLE_UPDATES=1

# ---- builder: full workspace install + build every package -----------------
# From `base`, not `agents`: building the packages needs no provider CLI, so a
# CLI version bump must not invalidate this stage's cache.
FROM base AS builder

COPY package.json package-lock.json ./
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
COPY packages/adapters/claude-code/package.json packages/adapters/claude-code/package.json
COPY packages/adapters/cursor/package.json packages/adapters/cursor/package.json
COPY packages/e2e/package.json packages/e2e/package.json
RUN npm ci

COPY tsconfig.base.json ./
COPY packages ./packages
RUN npm run build

# ---- agents: the provider CLIs named by the shared registry ----------------
# One install per providers/<id>/manifest.json with a non-null `install`.
# loop/bin/check-providers lints this list against the registry in both
# directions, keyed on the `provider-cli:` markers — the registry says which
# providers exist, this says which CLIs the image carries, and neither can
# derive the other.
#
#   id              cli      app      loop
#   claude-code     claude   adapter  bundle
#   codex           codex    stub     none
#   opencode        opencode stub     none
#   github-copilot  copilot  stub     none
#   cursor          agent    adapter  bundle
#
# Versions are pinned: session history is an undocumented format that drifts
# across releases (architecture-design.md §4). Bump deliberately, in the
# manifest and here, never via a floating `@latest`.
FROM base AS agents

# provider-cli: claude-code
# provider-cli: codex
# provider-cli: opencode
# provider-cli: github-copilot
RUN npm install -g \
      @anthropic-ai/claude-code@2.1.226 \
      @openai/codex@0.147.0 \
      opencode-ai@1.18.18 \
      @github/copilot@1.0.80 \
    && npm cache clean --force

# provider-cli: cursor
# Cursor ships a self-contained bundle with its own node, not an npm package,
# and its installer targets $HOME. $HOME is a volume mount point at runtime, so
# install it under /opt and put the CLI on PATH from there.
ARG CURSOR_VERSION=2026.08.25-3e8eec8
RUN HOME=/opt/cursor CURSOR_VERSION="${CURSOR_VERSION}" \
      sh -c 'curl -fsS https://cursor.com/install | bash' \
    && ln -sf /opt/cursor/.local/bin/agent /usr/local/bin/agent \
    && ln -sf /opt/cursor/.local/bin/cursor-agent /usr/local/bin/cursor-agent \
    && agent --version

# ---- dev: full workspace deps; source arrives as a bind mount --------------
# This project has no host-side run path (README "Run it"): `npm run dev` on the
# host is blocked by bin/_in-container.sh, and `loop/run` refuses the same way.
# Dev and prod differ only in how the code gets in — bind mount vs COPY — never
# in where it executes.
FROM agents AS dev

COPY package.json package-lock.json ./
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
COPY packages/adapters/claude-code/package.json packages/adapters/claude-code/package.json
COPY packages/adapters/cursor/package.json packages/adapters/cursor/package.json
COPY packages/e2e/package.json packages/e2e/package.json
RUN npm ci

ENV NODE_ENV=development

# node_modules is mounted as named volumes (compose overlays the bind mount of
# the source tree). Docker seeds each volume from the image dir on first mount,
# ownership included, so these must be overseer-owned *before* USER drops.
# .overseer is the same deal, and additionally must exist here so the volume it
# backs is seeded correctly — in dev the bind mount of the repo covers /app,
# and this named volume is what keeps the store off the host anyway.
RUN mkdir -p /app/.overseer/logs \
    && chown -R overseer:overseer /app /home/overseer

USER overseer
EXPOSE 3000 5173

# ---- test: dev image + Playwright browsers, used only by the e2e service ---
# Split from `dev` so `./bin/dev-start` never pays for a Chromium download —
# only the `e2e` service (docker-compose.dev.yml, ./bin/test-e2e) builds this.
FROM dev AS test

USER root
# --with-deps installs both the apt packages Chromium needs and the browser
# binary itself. Browsers land under PLAYWRIGHT_BROWSERS_PATH rather than
# root's default cache dir, because tests run as `overseer`, same as `dev`.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install --with-deps chromium \
    && chown -R overseer:overseer "$PLAYWRIGHT_BROWSERS_PATH"
USER overseer

# ---- runtime: production deps only + compiled output -----------------------
FROM agents AS runtime

COPY package.json package-lock.json ./
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/adapters/claude-code/package.json packages/adapters/claude-code/package.json
COPY packages/adapters/cursor/package.json packages/adapters/cursor/package.json
RUN npm ci --omit=dev --workspace packages/server \
      --workspace packages/protocol \
      --workspace packages/adapters/claude-code \
      --workspace packages/adapters/cursor \
    && apt-get purge -y python3 make g++ \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/packages/protocol/dist packages/protocol/dist
COPY --from=builder /app/packages/server/dist packages/server/dist
COPY --from=builder /app/packages/adapters/claude-code/dist packages/adapters/claude-code/dist
COPY --from=builder /app/packages/adapters/cursor/dist packages/adapters/cursor/dist
COPY --from=builder /app/packages/web/dist packages/web/dist

# The loop and the registry are code, so they ship with the image. In dev the
# repo bind mount already provides both. `.dockerignore` un-ignores loop/**/*.md
# specifically: overseer.md and steps/*.md are the session's instructions, and a
# blanket `*.md` rule would strip exactly the files that make the loop work.
COPY loop ./loop
COPY providers ./providers

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

# Docker seeds a fresh named volume from the image's dir on first mount,
# ownership included — without this the overseer user can't write its own
# memory (docs/overseer.md §6.2) or the loop's file store.
RUN mkdir -p /app/.overseer/logs /app/loop/db \
    && chown -R overseer:overseer /app/.overseer /app/loop/db /home/overseer

USER overseer
EXPOSE 3000
CMD ["node", "packages/server/dist/index.js"]
