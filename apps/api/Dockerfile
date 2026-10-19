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
COPY --from=deps /app/packages/wire/node_modules ./packages/wire/node_modules
COPY apps/api ./apps/api
COPY tsconfig.base.json ./tsconfig.base.json
COPY packages/wire ./packages/wire
RUN cd apps/api && bun run build

FROM node:22.13.1-slim AS runtime
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=oven/bun:1.4.2 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/tsconfig.json ./apps/api/tsconfig.json
COPY --from=builder /app/apps/api/prisma.config.ts ./apps/api/prisma.config.ts
COPY --from=builder /app/apps/api/src ./apps/api/src
COPY --from=builder /app/packages/wire/src ./packages/wire/src
COPY --from=builder /app/packages/wire/package.json ./packages/wire/package.json
COPY --from=builder /app/packages/wire/node_modules ./packages/wire/node_modules
COPY --from=builder /app/apps/api/envs ./apps/api/envs
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder /app/apps/api/scripts ./apps/api/scripts

WORKDIR /app/apps/api
ENV NODE_ENV=production
EXPOSE 3400

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD bun -e "fetch('http://localhost:'+(process.env.PORT ?? 3400)+'/v1/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["bun", "src/main.ts"]
