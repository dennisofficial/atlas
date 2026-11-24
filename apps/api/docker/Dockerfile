FROM oven/bun:1.4.2-debian AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile --filter @dltech/atlas-api --filter @dltech/atlas-daemon \
  && bun run --cwd apps/daemon build \
  && rm -rf /root/.bun/install/cache

FROM oven/bun:1.4.2-debian
ARG ATLAS_APP_VERSION
ENV ATLAS_APP_VERSION=$ATLAS_APP_VERSION
RUN apt-get update \
  && apt-get install -y --no-install-recommends git openssh-client procps ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production APP_TIER=production PORT=10000
EXPOSE 10000
CMD ["bun", "run", "--cwd", "apps/api", "start"]
