# syntax=docker/dockerfile:1.7

# Build context is the repo ROOT, not apps/api: bun needs the workspace
# manifests to honor --frozen-lockfile, and the api's node_modules are
# symlinks into the root store (bunfig.toml pins the isolated linker).

ARG BUN_IMAGE=oven/bun:1.3.14

FROM ${BUN_IMAGE} AS deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY apps/api/package.json ./apps/api/
COPY apps/tui/package.json ./apps/tui/
COPY apps/web/package.json ./apps/web/
COPY packages/core/package.json ./packages/core/
COPY packages/harness/package.json ./packages/harness/
COPY packages/ui/package.json ./packages/ui/
RUN --mount=type=cache,id=bun-install-cache,target=/root/.bun/install/cache \
  bun install --frozen-lockfile --ignore-scripts --filter '@dltech/atlas-api'

FROM ${BUN_IMAGE} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY apps/api ./apps/api
COPY tsconfig.base.json ./tsconfig.base.json
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
COPY tsconfig.base.json ./tsconfig.base.json
# The stamp hashes the serve SOURCE, not the compiled binary: `bun build --compile` is not
# byte-reproducible, so hashing the binary would churn the stamp — and force a fleet-wide
# re-download of the sandbox's serve binary — on every deploy even when nothing behavioral
# changed. `find | sort | sha256sum` over the sorted file list keeps the hash deterministic.
RUN cd packages/harness && bun run db:ensure \
  && bun run build:serve -- --target bun-linux-x64 --outfile bin/atlas-serve \
  && cd /app && find packages/harness/src packages/core/src -type f | LC_ALL=C sort \
  | xargs sha256sum | sha256sum | cut -d' ' -f1 > packages/harness/bin/atlas-serve.sha256

FROM node:22.13.1-slim AS runtime
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/prisma.config.ts ./apps/api/prisma.config.ts
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/envs ./apps/api/envs
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --from=serve-binary /app/packages/harness/bin/atlas-serve /app/atlas-serve
COPY --from=serve-binary /app/packages/harness/bin/atlas-serve.sha256 /app/atlas-serve.sha256
COPY --from=builder /app/apps/api/scripts ./apps/api/scripts

WORKDIR /app/apps/api
ENV NODE_ENV=production
EXPOSE 3400

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT ?? 3400)+'/v1/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/main.js"]
