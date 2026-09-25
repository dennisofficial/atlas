# syntax=docker/dockerfile:1.7

# Build context is the repo ROOT, not apps/api: bun needs the workspace
# manifests to honor --frozen-lockfile, and the api's node_modules are
# symlinks into the root store (bunfig.toml pins the isolated linker).

ARG BUN_IMAGE=oven/bun:1.4.2

FROM ${BUN_IMAGE} AS deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY apps/api/package.json ./apps/api/
COPY apps/tui/package.json ./apps/tui/
COPY apps/web/package.json ./apps/web/
COPY packages/core/package.json ./packages/core/
COPY packages/harness/package.json ./packages/harness/
COPY packages/ui/package.json ./packages/ui/
COPY packages/wire/package.json ./packages/wire/
RUN --mount=type=cache,id=bun-install-cache,target=/root/.bun/install/cache \
  bun install --frozen-lockfile --ignore-scripts --filter '@dltech/atlas-api'

FROM ${BUN_IMAGE} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY apps/api ./apps/api
COPY tsconfig.base.json ./tsconfig.base.json
# The api imports @dltech/atlas-wire at runtime; its dist is built here so the runtime stage
# can copy compiled JS rather than raw TS.
COPY packages/wire ./packages/wire
RUN cd packages/wire && bun run build
RUN cd apps/api && bun run build

FROM ${BUN_IMAGE} AS serve-deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY apps/api/package.json ./apps/api/
COPY apps/tui/package.json ./apps/tui/
COPY apps/web/package.json ./apps/web/
COPY packages/core/package.json ./packages/core/
COPY packages/harness/package.json ./packages/harness/
COPY packages/ui/package.json ./packages/ui/
COPY packages/wire/package.json ./packages/wire/
RUN --mount=type=cache,id=bun-install-cache,target=/root/.bun/install/cache \
  bun install --frozen-lockfile --ignore-scripts --os='*' --cpu='*' --filter '@dltech/atlas-harness'

# The target is pinned, not host-derived: an arm64 builder (every macOS laptop) must not
# ship a binary the linux/amd64 sandbox cannot exec.
FROM ${BUN_IMAGE} AS serve-binary
WORKDIR /app
COPY --from=serve-deps /app/node_modules ./node_modules
COPY --from=serve-deps /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=serve-deps /app/packages/harness/node_modules ./packages/harness/node_modules
COPY packages/core ./packages/core
COPY packages/harness ./packages/harness
COPY packages/wire ./packages/wire
COPY tsconfig.base.json ./tsconfig.base.json
# The stamp hashes the serve SOURCE, not the compiled binary: `bun build --compile` is not
# byte-reproducible, so hashing the binary would churn the stamp — and force a fleet-wide
# re-download of the sandbox's serve binary — on every deploy even when nothing behavioral
# changed. The recipe lives in packages/harness/scripts/serve-source-stamp.sh and is shared with
# the VCR sandbox image so a matching bake is reused instead of re-downloaded.
RUN cd packages/harness && bun run build:serve -- --target bun-linux-x64 --outfile bin/atlas-serve \
  && cd /app && sh packages/harness/scripts/serve-source-stamp.sh > packages/harness/bin/atlas-serve.sha256

FROM node:22.13.1-slim AS runtime
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/prisma.config.ts ./apps/api/prisma.config.ts
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages/wire/dist ./packages/wire/dist
COPY --from=builder /app/packages/wire/package.json ./packages/wire/package.json
COPY --from=builder /app/apps/api/envs ./apps/api/envs
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --from=serve-binary /app/packages/harness/bin/atlas-serve /app/atlas-serve
COPY --from=serve-binary /app/packages/harness/bin/atlas-serve.sha256 /app/atlas-serve.sha256
COPY --from=builder /app/apps/api/scripts ./apps/api/scripts

WORKDIR /app/apps/api
ENV NODE_ENV=production
# The instance this runs on is 0.5GB: cap the old-space heap under it so memory pressure kills
# the process cleanly (and the platform restarts it) instead of wedging the container at the
# kernel OOM killer, which also wipes the in-process wake/reply-watch state.
ENV NODE_OPTIONS=--max-old-space-size=384
EXPOSE 3400

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT ?? 3400)+'/v1/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/main.js"]
