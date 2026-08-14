# syntax=docker/dockerfile:1

ARG NODE_IMAGE=node:24-trixie-slim

# ---- builder: full workspace install + build every package -----------------
FROM ${NODE_IMAGE} AS builder
WORKDIR /app

# node-pty needs a native toolchain during `npm ci` / build.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
COPY packages/adapters/claude-code/package.json packages/adapters/claude-code/package.json
COPY packages/e2e/package.json packages/e2e/package.json
RUN npm ci

COPY tsconfig.base.json ./
COPY packages ./packages
RUN npm run build

# ---- dev: full workspace deps + agent CLI; source arrives as a bind mount ---
# This project has no host-side run path (README "Run it"): `npm run dev` on the
# host is blocked by bin/_in-container.sh. Dev and prod differ only in how the
# code gets in — bind mount vs COPY — never in where it executes.
FROM ${NODE_IMAGE} AS dev

# Same toolchain as runtime: the claude-code adapter shells out to git/ripgrep,
# so a dev container has to be able to exercise the real spawn path.
# python3/make/g++: node-pty (raw OPEN CONSOLE PTY) is a native module.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ripgrep ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @anthropic-ai/claude-code@2.1.226 \
    && npm cache clean --force

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
COPY packages/adapters/claude-code/package.json packages/adapters/claude-code/package.json
COPY packages/e2e/package.json packages/e2e/package.json
RUN npm ci

ENV NODE_ENV=development
ENV CLAUDE_CONFIG_DIR=/home/node/.claude
# The overseer's internal memory (docs/overseer.md §6.2). Stated here rather
# than inferred at runtime, for the same reason CLAUDE_CONFIG_DIR is: where the
# store lives is a deployment fact the image owns.
ENV OVERSEER_INTERNAL_DIR=/app/.overseer
# Read by bin/_in-container.sh — the only thing that distinguishes a sanctioned
# run from someone typing `npm run dev` in a host terminal.
ENV OVERSEER_IN_CONTAINER=1
# Claude is pinned in the image and runs as non-root `node`; auto-update cannot
# write the global npm prefix and would only noise the OPEN CONSOLE TUI.
ENV DISABLE_AUTOUPDATER=1
ENV DISABLE_UPDATES=1

# node_modules is mounted as named volumes (compose overlays the bind mount of
# the source tree). Docker seeds each volume from the image dir on first mount,
# ownership included, so these must be node-owned *before* USER drops.
# .overseer is the same deal, and additionally must exist here so the volume it
# backs is seeded node-owned — in dev the bind mount of the repo covers /app,
# and this named volume is what keeps the store off the host anyway.
RUN mkdir -p /home/node/.claude /app/.overseer/logs \
    && chown -R node:node /home/node/.claude /app

USER node
EXPOSE 3000 5173

# ---- test: dev image + Playwright browsers, used only by the e2e service ---
# Split from `dev` so `./bin/dev-start` never pays for a Chromium download —
# only the `e2e` service (docker-compose.dev.yml, ./bin/test-e2e) builds this.
FROM dev AS test

USER root
# --with-deps installs both the apt packages Chromium needs and the browser
# binary itself. Browsers land under PLAYWRIGHT_BROWSERS_PATH rather than
# root's default cache dir, because tests run as `node`, same as `dev`.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install --with-deps chromium \
    && chown -R node:node "$PLAYWRIGHT_BROWSERS_PATH"
USER node

# ---- runtime: production deps only + compiled output -----------------------
FROM ${NODE_IMAGE} AS runtime

# git and ripgrep: the CLI shells out to both. Pinned CLI version: JSONL
# session history is an undocumented format that drifts across releases
# (design doc §4) — bump deliberately, not via floating `@latest`.
# python3/make/g++: node-pty for the raw OPEN CONSOLE escape hatch. Auth login
# still uses plain pipes (architecture-design.md §2); the console is the only
# PTY path. Build tools are removed after `npm ci` so the runtime image stays lean.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ripgrep ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @anthropic-ai/claude-code@2.1.226 \
    && npm cache clean --force

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/adapters/claude-code/package.json packages/adapters/claude-code/package.json
RUN npm ci --omit=dev --workspace packages/server \
      --workspace packages/protocol \
      --workspace packages/adapters/claude-code \
    && apt-get purge -y python3 make g++ \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/packages/protocol/dist packages/protocol/dist
COPY --from=builder /app/packages/server/dist packages/server/dist
COPY --from=builder /app/packages/adapters/claude-code/dist packages/adapters/claude-code/dist
COPY --from=builder /app/packages/web/dist packages/web/dist

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV CLAUDE_CONFIG_DIR=/home/node/.claude
ENV OVERSEER_INTERNAL_DIR=/app/.overseer
# Same as the dev stage: pinned CLI, non-root runtime, no in-container updates.
ENV DISABLE_AUTOUPDATER=1
ENV DISABLE_UPDATES=1

# Docker seeds a fresh named volume from the image's dir on first mount,
# ownership included — without this the node user can't write its own config,
# or its own memory (docs/overseer.md §6.2).
RUN mkdir -p /home/node/.claude /app/.overseer/logs \
    && chown -R node:node /home/node/.claude /app/.overseer

USER node
EXPOSE 3000
CMD ["node", "packages/server/dist/index.js"]
