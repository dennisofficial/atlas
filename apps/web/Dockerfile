# syntax=docker/dockerfile:1.7

# Build context is the repo ROOT, same as apps/api/Dockerfile: bun needs the
# workspace manifests for --frozen-lockfile, and node_modules are symlinks into
# the root store (bunfig.toml pins the isolated linker).

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
  bun install --frozen-lockfile --ignore-scripts --filter '@dltech/atlas-web'

FROM ${BUN_IMAGE} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY apps/web ./apps/web
RUN cd apps/web && bun run build

FROM node:22.13.1-slim AS runtime
WORKDIR /app
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static

WORKDIR /app/apps/web
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT ?? 3000)+'/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
