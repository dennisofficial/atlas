FROM oven/bun:1.4.2-debian AS base

FROM base AS manifests
WORKDIR /src
COPY . .
RUN mkdir /out \
  && cp --parents package.json */package.json */*/package.json bun.lock bunfig.toml /out \
  && cp --parents scripts/install-git-hooks.sh /out \
  && cp -r --parents patches /out

FROM base AS deps
WORKDIR /app
COPY --from=manifests /out/ ./
RUN bun install --frozen-lockfile --filter @dltech/atlas-api --filter @dltech/atlas-daemon \
  && rm -rf /root/.bun/install/cache

FROM base AS daemon
WORKDIR /app
COPY --from=manifests /out/ ./
RUN bun install --frozen-lockfile --filter @dltech/atlas-daemon \
  && rm -rf /root/.bun/install/cache
COPY tsconfig.base.json ./
COPY apps/daemon/ apps/daemon/
COPY packages/commands/ packages/commands/
COPY packages/core/ packages/core/
COPY packages/protocol/ packages/protocol/
COPY packages/sandbox/ packages/sandbox/
RUN bun run --cwd apps/daemon build

FROM base AS source
WORKDIR /src
COPY . .
RUN rm -rf plugins/skills/skills packages/db/migrations

FROM base
RUN apt-get update \
  && apt-get install -y --no-install-recommends git openssh-client procps ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --link --from=deps /app/ ./
COPY --link plugins/skills/skills/ plugins/skills/skills/
COPY --link packages/db/migrations/ packages/db/migrations/
COPY --link --from=source /src/ ./
COPY --link --from=daemon /app/apps/daemon/bin/ apps/daemon/bin/
ENV NODE_ENV=production APP_TIER=production PORT=10000
EXPOSE 10000
ARG ATLAS_APP_VERSION
ENV ATLAS_APP_VERSION=$ATLAS_APP_VERSION
CMD ["bun", "run", "--cwd", "apps/api", "start"]
