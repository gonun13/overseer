# syntax=docker/dockerfile:1

# ---- builder: full workspace install + build every package -----------------
FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
COPY packages/adapters/mock/package.json packages/adapters/mock/package.json
COPY packages/adapters/claude-code/package.json packages/adapters/claude-code/package.json
RUN npm ci

COPY tsconfig.base.json ./
COPY packages ./packages
RUN npm run build

# ---- runtime: production deps only + compiled output -----------------------
FROM node:22-bookworm-slim AS runtime

# git and ripgrep: the CLI shells out to both. Pinned CLI version: JSONL
# session history is an undocumented format that drifts across releases
# (design doc §4) — bump deliberately, not via floating `@latest`.
# node-pty (auth PTY flow, §2) needs build-essential/python3 added here once it lands.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ripgrep ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @anthropic-ai/claude-code@2.1.226 \
    && npm cache clean --force

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/adapters/mock/package.json packages/adapters/mock/package.json
COPY packages/adapters/claude-code/package.json packages/adapters/claude-code/package.json
RUN npm ci --omit=dev --workspace packages/server \
      --workspace packages/protocol \
      --workspace packages/adapters/mock \
      --workspace packages/adapters/claude-code

COPY --from=builder /app/packages/protocol/dist packages/protocol/dist
COPY --from=builder /app/packages/server/dist packages/server/dist
COPY --from=builder /app/packages/adapters/mock/dist packages/adapters/mock/dist
COPY --from=builder /app/packages/adapters/claude-code/dist packages/adapters/claude-code/dist
COPY --from=builder /app/packages/web/dist packages/web/dist

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV CLAUDE_CONFIG_DIR=/home/node/.claude

# Docker seeds a fresh named volume from the image's dir on first mount,
# ownership included — without this the node user can't write its own config.
RUN mkdir -p /home/node/.claude && chown -R node:node /home/node/.claude

USER node
EXPOSE 3000
CMD ["node", "packages/server/dist/index.js"]
