#!/bin/sh
# End-to-end proof of the cloud transition path, runnable on any dev machine:
# transfer up (idempotent), the serve running a turn over the socket (streaming, ledger,
# legible failure, wake after park), and transfer down + re-lift. Everything runs against a
# throwaway Postgres container and a throwaway API boot; nothing touches production.
#
#   sh scripts/e2e-cloud/run.sh
#
# Env overrides: E2E_PG_PORT (5544), E2E_API_PORT (3401), E2E_SERVE_PORT (3402),
# E2E_MOCK_PORT (3403), E2E_PG_HOST (localhost; host.docker.internal from inside a container).
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
PG_CONTAINER=${E2E_PG_CONTAINER:-atlas-e2e-cloud-pg}
PG_PORT=${E2E_PG_PORT:-5544}
PG_HOST=${E2E_PG_HOST:-localhost}
API_PORT=${E2E_API_PORT:-3401}
SERVE_PORT=${E2E_SERVE_PORT:-3402}
MOCK_PORT=${E2E_MOCK_PORT:-3403}
API_URL=http://localhost:$API_PORT
DATABASE_URL=postgresql://postgres:postgres@$PG_HOST:$PG_PORT/postgres

cleanup() {
  [ "${API_PID:-}" = "" ] || kill "$API_PID" 2>/dev/null || true
  docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$PG_CONTAINER" -p "$PG_PORT:5432" -e POSTGRES_PASSWORD=postgres postgres:16-alpine >/dev/null
echo "postgres container $PG_CONTAINER up on $PG_HOST:$PG_PORT"

for i in $(seq 1 60); do
  if docker exec "$PG_CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done

cd "$ROOT/apps/api"
DATABASE_URL="$DATABASE_URL" bunx prisma migrate deploy >/dev/null
if [ "${E2E_SKIP_BUILD:-}" = "1" ]; then
  [ -d dist/api ] || { echo "E2E_SKIP_BUILD=1 but apps/api/dist is missing"; exit 1; }
else
  bun run build >/dev/null
fi

DATABASE_URL="$DATABASE_URL" \
SECRET_KEY='e2e-rig-secret-key-with-plenty-of-length' \
SECRETS_ENCRYPTION_KEY='a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2' \
RATE_LIMIT_PER_MINUTE=100000 \
PORT=$API_PORT node --max-old-space-size=1024 dist/api/main.js >/tmp/e2e-cloud-api.log 2>&1 &
API_PID=$!

ready=0
for i in $(seq 1 90); do
  if curl -sf -m 2 "$API_URL/v1/health" >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
if [ "$ready" != "1" ]; then echo "API never became healthy"; tail -20 /tmp/e2e-cloud-api.log; exit 1; fi
echo "api healthy on $API_URL"

rm -rf /tmp/e2e-cloud-serve-home /tmp/e2e-cloud-ws
mkdir -p /tmp/e2e-cloud-serve-home /tmp/e2e-cloud-ws
cd "$ROOT"
E2E_API_URL=$API_URL E2E_PG_CONTAINER=$PG_CONTAINER E2E_SERVE_PORT=$SERVE_PORT E2E_MOCK_PORT=$MOCK_PORT \
  bun scripts/e2e-cloud/transfer-up.mjs
E2E_API_URL=$API_URL E2E_PG_CONTAINER=$PG_CONTAINER E2E_SERVE_PORT=$SERVE_PORT E2E_MOCK_PORT=$MOCK_PORT \
  ATLAS_HOME=/tmp/e2e-cloud-serve-home bun scripts/e2e-cloud/serve-turn.mts
E2E_API_URL=$API_URL E2E_PG_CONTAINER=$PG_CONTAINER E2E_SERVE_PORT=$SERVE_PORT E2E_MOCK_PORT=$MOCK_PORT \
  bun scripts/e2e-cloud/transfer-down.mjs

echo "E2E CLOUD: ALL PHASES GREEN"
