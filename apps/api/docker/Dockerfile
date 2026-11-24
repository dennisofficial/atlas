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

FROM deps AS build
COPY . .
RUN bun run --cwd apps/daemon build

FROM base
RUN apt-get update \
  && apt-get install -y --no-install-recommends git openssh-client procps ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app/ ./
COPY . .
COPY --from=build /app/apps/daemon/bin/ apps/daemon/bin/
ENV NODE_ENV=production APP_TIER=production PORT=10000
EXPOSE 10000
ARG ATLAS_APP_VERSION
ENV ATLAS_APP_VERSION=$ATLAS_APP_VERSION
CMD ["bun", "run", "--cwd", "apps/api", "start"]
