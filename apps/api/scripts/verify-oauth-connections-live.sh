#!/usr/bin/env bash
set -euo pipefail

CONTAINER="atlas-oauth-live-$$"
PORT=55438
DATABASE="atlas_oauth_test"
URL="postgresql://postgres@127.0.0.1:${PORT}/${DATABASE}"
READY_ATTEMPTS=60

cd "$(dirname "$0")/.."
if docker container inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "refusing to replace existing container $CONTAINER" >&2
  exit 1
fi
printf 'Creating disposable OAuth database container %s on port %s\n' "$CONTAINER" "$PORT"
cleanup() {
  if docker container inspect "$CONTAINER" >/dev/null 2>&1; then
    printf 'Removing disposable OAuth database container %s\n' "$CONTAINER"
    docker rm -f "$CONTAINER" >/dev/null
  fi
}
trap cleanup EXIT

docker run -d --network bridge --name "$CONTAINER" -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB="$DATABASE" \
  -p "127.0.0.1:${PORT}:5432" postgres:16-alpine >/dev/null

ready=0
for _ in $(seq "$READY_ATTEMPTS"); do
  if docker exec "$CONTAINER" psql -U postgres -d "$DATABASE" -tAc 'select 1' >/dev/null 2>&1; then
    ready=1
    sleep 1
    break
  fi
  sleep 1
done
[ "$ready" = 1 ] || { echo "postgres never became ready" >&2; exit 1; }

DIRECT_URL="$URL" DATABASE_URL="$URL" bunx prisma migrate deploy
ATLAS_LIVE_OAUTH_DB=1 bunx vitest run --maxWorkers=1 test/oauth-connections-live.spec.ts
