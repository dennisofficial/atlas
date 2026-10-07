#!/usr/bin/env bash
set -euo pipefail

image="${1:?usage: smoke.sh <image-tag>}"
name="atlas-sandbox-smoke-$$"

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

run_args=(-d --name "$name")
if [ -S /var/run/docker.sock ]; then
  run_args+=(-v /var/run/docker.sock:/var/run/docker.sock)
fi
docker run "${run_args[@]}" "$image" sleep infinity >/dev/null

checks=0
failures=0

expect() {
  local label="$1" want="$2"
  shift 2
  checks=$((checks + 1))
  local out
  if out=$("$@" 2>&1) && [[ "$out" == *"$want"* ]]; then
    printf 'ok %d - %s\n' "$checks" "$label"
  else
    failures=$((failures + 1))
    printf 'FAIL %d - %s (wanted substring %q)\n%s\n' "$checks" "$label" "$want" "$out"
  fi
}

expect_fail() {
  local label="$1"
  shift
  checks=$((checks + 1))
  local out
  if out=$("$@" 2>&1); then
    failures=$((failures + 1))
    printf 'FAIL %d - %s (expected non-zero exit)\n%s\n' "$checks" "$label" "$out"
  else
    printf 'ok %d - %s\n' "$checks" "$label"
  fi
}

run() { docker exec "$name" sh -c "$1"; }
run501() { docker exec --user 501:20 -e HOME=/tmp/smoke-home "$name" sh -c "$1"; }

run 'mkdir -p /tmp/smoke-home /Users/smoke && chmod 777 /tmp/smoke-home'

expect 'git present' 'git version 2.' run 'git --version'
expect 'ssh present' 'OpenSSH' run 'ssh -V'
expect 'gpg present' 'gpg' run 'gpg --version'
expect 'curl present' 'curl' run 'curl --version'
expect 'ps present' 'procps' run 'ps --version'
expect 'ripgrep present' 'ripgrep' run 'rg --version'
expect 'docker cli present' 'Docker version' run 'docker --version'
expect 'compose plugin present' 'Docker Compose version' run 'docker compose version'
expect 'gh present' 'gh version' run 'gh --version'
expect 'jq present' 'jq-' run 'jq --version'
expect 'git-lfs present' 'git-lfs' run 'git lfs version'
expect 'psql present' 'psql' run 'psql --version'
expect 'linear present' '.' run 'linear --version'
expect 'aws present' 'aws-cli/2' run 'aws --version'
expect 'gcloud present' 'Google Cloud SDK' run 'CLOUDSDK_PYTHON=/usr/bin/python3 gcloud --version'
expect 'gsutil present' 'gsutil version' run 'CLOUDSDK_PYTHON=/usr/bin/python3 gsutil version'
expect 'bq present' 'BigQuery CLI' run 'CLOUDSDK_PYTHON=/usr/bin/python3 bq version'
expect 'doctl present' 'doctl version' run 'doctl version'
expect 'pulumi present' 'v3.' run 'pulumi version'
expect 'stripe present' 'stripe version' run 'stripe --version'
expect 'terraform present' 'Terraform v' run 'terraform version'
expect 'cloudflared present' 'cloudflared version' run 'cloudflared --version'
expect 'vercel present' '.' run 'vercel --version'

expect 'node resolves via mise shim' '/opt/mise/shims/node' run 'command -v node'
expect 'python resolves via mise shim' '/opt/mise/shims/python' run 'command -v python'
expect 'bun resolves via mise shim' '/opt/mise/shims/bun' run 'command -v bun'
expect 'node runs' 'v' run 'node --version'
expect 'python runs' 'Python 3.' run 'python --version'
expect 'bun runs' '.' run 'bun --version'

run 'mkdir -p /Users/smoke/node22 && echo 22 > /Users/smoke/node22/.nvmrc'
expect '.nvmrc auto-switches node to 22' 'v22.' run 'cd /Users/smoke/node22 && node --version'
expect 'node outside fixture is not 22' 'v' run 'node --version | grep -v "^v22\."'

expect_fail 'uninstalled bun pin fails loudly instead of falling through' \
  run 'mkdir -p /Users/smoke/bunpin && echo 0.0.1 > /Users/smoke/bunpin/.bun-version && cd /Users/smoke/bunpin && bun --version'

expect 'idiomatic version files enabled as uid 501 with foreign HOME' 'node' \
  run501 'mise settings get idiomatic_version_file_enable_tools'
expect 'no system fallback as uid 501 with foreign HOME' 'false' \
  run501 'mise settings get not_found_system_fallback'
expect 'trusted_config_paths covers any bind-mounted path' '["/"]' run501 'mise settings get trusted_config_paths'

yarn_version=$(run 'ls /opt/corepack/v1/yarn | head -n1')
pnpm_version=$(run 'ls /opt/corepack/v1/pnpm | head -n1')
run501 "mkdir -p /tmp/smoke-home/yarnproj /tmp/smoke-home/pnpmproj \
  && printf '{\"private\":true,\"packageManager\":\"yarn@${yarn_version}\"}\n' > /tmp/smoke-home/yarnproj/package.json \
  && printf '{\"private\":true,\"packageManager\":\"pnpm@${pnpm_version}\"}\n' > /tmp/smoke-home/pnpmproj/package.json"
expect 'seeded yarn resolves offline via packageManager' "$yarn_version" \
  run501 'cd /tmp/smoke-home/yarnproj && COREPACK_ENABLE_NETWORK=0 yarn --version'
expect 'seeded pnpm resolves offline via packageManager' "$pnpm_version" \
  run501 'cd /tmp/smoke-home/pnpmproj && COREPACK_ENABLE_NETWORK=0 pnpm --version'
npm_version=$(run 'ls /opt/corepack/v1/npm | head -n1')
run501 "mkdir -p /tmp/smoke-home/npmproj \
  && printf '{\"private\":true,\"packageManager\":\"npm@${npm_version}\"}\n' > /tmp/smoke-home/npmproj/package.json"
expect 'seeded npm resolves offline via packageManager' "$npm_version" \
  run501 'cd /tmp/smoke-home/npmproj && COREPACK_ENABLE_NETWORK=0 npm --version'

launch_js=$(mktemp /tmp/atlas-smoke-chromium.XXXXXX.js)
cat > "$launch_js" <<'EOF'
const { chromium } = require('/opt/playwright-runner/node_modules/playwright')
chromium
  .launch({ headless: true, args: ['--no-sandbox'] })
  .then(async (browser) => {
    const page = await browser.newPage()
    await page.setContent('<h1>atlas</h1>')
    const text = await page.textContent('h1')
    await browser.close()
    if (text !== 'atlas') {
      console.error(`unexpected page text: ${text}`)
      process.exit(1)
    }
    console.log('chromium OK')
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
EOF
docker cp "$launch_js" "$name":/tmp/chromium-launch.js >/dev/null
rm -f "$launch_js"
run 'chmod 644 /tmp/chromium-launch.js'
expect 'headless chromium launches as uid 501' 'chromium OK' run501 'node /tmp/chromium-launch.js'

expect 'playwright-cli resolves on PATH' '/usr/local/bin/playwright-cli' run 'command -v playwright-cli'
expect 'playwright-cli runs' '.' run 'playwright-cli --version'
expect 'a chromium build is baked into the shared browsers path' 'chromium' \
  run 'ls /opt/playwright'
expect 'playwright-cli open renders with the baked browser as uid 501' 'Page URL: about:blank' \
  run501 'cd /tmp/smoke-home && playwright-cli open about:blank && playwright-cli close'

run 'git init -q /opt/smoke-repo'
expect_fail 'git refuses a root-owned repo without safe.directory (no blanket star baked)' \
  run501 'git -C /opt/smoke-repo status'
expect_fail 'image bakes no system-level safe.directory' \
  run 'git config --system --get-all safe.directory'
expect 'scoped safe.directory wildcard env works as uid 501' 'nothing to commit' \
  docker exec --user 501:20 -e HOME=/tmp/smoke-home \
    -e GIT_CONFIG_COUNT=2 \
    -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0=/opt/smoke-repo \
    -e GIT_CONFIG_KEY_1=safe.directory '-e' 'GIT_CONFIG_VALUE_1=/opt/smoke-repo/*' \
    "$name" sh -c 'git -C /opt/smoke-repo status'

expect 'node works under docker run as uid 501 with tmp HOME' 'v' \
  docker run --rm --user 501:20 -e HOME=/tmp/smoke-home "$image" sh -c 'node --version'

expect 'aws runs as uid 501' 'aws-cli/2' run501 'aws --version'
expect 'gcloud runs as uid 501' 'Google Cloud SDK' run501 'CLOUDSDK_PYTHON=/usr/bin/python3 gcloud --version'
expect 'vercel runs as uid 501' '.' run501 'vercel --version'

# sudo refuses a uid with no passwd record before it ever reads sudoers, so the grant can only
# be exercised through a named account; the Atlas bootstrap synthesizes the operator entry at
# runtime, which the harness live specs cover — here the baked-in node user stands in for it
expect 'passwordless sudo reaches root for a named user' 'uid=0(root)' \
  docker exec --user node -e HOME=/tmp/smoke-home "$name" sh -c 'sudo -n id'

if [ -S /var/run/docker.sock ]; then
  expect 'mounted docker socket reachable as uid 501' 'Server Version' run501 'docker info'
fi

expect 'shim shadows the real cli on PATH' '/usr/local/bin/docker' run 'command -v docker'
expect 'docker-daemon-up helper is on PATH' '/usr/local/bin/docker-daemon-up' \
  run 'command -v docker-daemon-up'

# an unprivileged nested container has no NET_ADMIN, so dockerd can never come up there; the
# check is that the shim got as far as launching the daemon — before the blanket sudo grant the
# same call died at sudo itself. Full-root Vercel microVMs are where the daemon actually runs.
docker run -d --name "$name-nested" --entrypoint sh "$image" -c 'sleep infinity' >/dev/null
expect 'shim launches dockerd through sudo for a named user' 'atlas-dockerd.log' \
  docker exec --user node -e HOME=/tmp/smoke-home "$name-nested" sh -c 'docker info 2>&1 || true'
docker rm -f "$name-nested" >/dev/null

if [ -S /var/run/docker.sock ]; then
  expect 'shim passes through to the mounted socket as uid 501' 'Server Version' \
    run501 'docker info'
fi

printf '\n%d checks, %d failures\n' "$checks" "$failures"
[ "$failures" -eq 0 ]
