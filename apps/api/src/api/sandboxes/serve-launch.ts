import type { Sandbox } from '@vercel/sandbox'

export const SERVE_BINARY_PATH = '/vercel/sandbox/atlas-serve'
export const SERVE_LOG_PATH = '/vercel/sandbox/atlas-serve.log'
export const SERVE_LOCK_PATH = '/vercel/sandbox/atlas-serve.lock'

const HEALTH_ATTEMPTS = 90
const HEALTH_INTERVAL_SECONDS = 2
const HEALTH_WAIT_TIMEOUT_MS = (HEALTH_ATTEMPTS * HEALTH_INTERVAL_SECONDS + 30) * 1000
const DOWNLOAD_TIMEOUT_MS = 300_000
const QUICK_COMMAND_TIMEOUT_MS = 15_000
const EXIT_AUTH_STALE = 41

export class StaleSandboxTokenError extends Error {
  constructor() {
    super('the sandbox carries a serve token this deployment no longer recognizes')
    this.name = 'StaleSandboxTokenError'
  }
}

export const HEALTH_PROBE = `curl -sf -m 5 --connect-timeout 2 -H "Authorization: Bearer $ATLAS_SERVE_TOKEN" "http://localhost:$ATLAS_SERVE_PORT/v1/health" -o /dev/null`

const sh = (args: { sandbox: Sandbox; script: string; timeoutMs?: number }) =>
  args.sandbox.runCommand({
    cmd: 'sh',
    args: ['-c', args.script],
    ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
  })

const serveHealthy = async (sandbox: Sandbox): Promise<boolean> =>
  (await sh({ sandbox, script: HEALTH_PROBE, timeoutMs: QUICK_COMMAND_TIMEOUT_MS })).exitCode === 0

const installedHash = async (sandbox: Sandbox): Promise<string> => {
  const hashed = await sh({
    sandbox,
    script: `sha256sum ${SERVE_BINARY_PATH} 2>/dev/null | cut -d' ' -f1`,
    timeoutMs: QUICK_COMMAND_TIMEOUT_MS,
  })
  return (await hashed.stdout()).trim()
}

const MATCHING_SERVE = `grep -qa '^${SERVE_BINARY_PATH}' "$pid/cmdline" 2>/dev/null`

const KILL_WEDGED_SERVE = `for pid in /proc/[0-9]*; do
  if ${MATCHING_SERVE}; then kill "\${pid#/proc/}" 2>/dev/null; fi
done
for i in $(seq 10); do
  survivors=0
  for pid in /proc/[0-9]*; do
    if ${MATCHING_SERVE}; then survivors=1; fi
  done
  [ "$survivors" = "0" ] && break
  sleep 0.5
done
for pid in /proc/[0-9]*; do
  if ${MATCHING_SERVE}; then kill -9 "\${pid#/proc/}" 2>/dev/null; fi
done
true`

const downloadBinary = `mkdir -p /vercel/sandbox && ` +
  `code=$(curl -sS --retry 3 --retry-all-errors --connect-timeout 10 -m 240 ` +
  `-H "Authorization: Bearer $ATLAS_SERVE_TOKEN" ` +
  `"$ATLAS_CLOUD_URL/v1/sandboxes/$ATLAS_THREAD_ID/serve-binary" ` +
  `-o ${SERVE_BINARY_PATH} -w '%{http_code}') || exit $?; ` +
  `if [ "$code" = "401" ]; then exit ${EXIT_AUTH_STALE}; fi; ` +
  `if [ "$code" != "200" ]; then echo "download answered HTTP $code" >&2; exit 22; fi; ` +
  `chmod 755 ${SERVE_BINARY_PATH}`

const serveLogTail = async (sandbox: Sandbox): Promise<string> => {
  const tail = await sh({
    sandbox,
    script: `tail -c 16384 ${SERVE_LOG_PATH} 2>/dev/null || true`,
    timeoutMs: QUICK_COMMAND_TIMEOUT_MS,
  }).catch(() => null)
  if (tail === null) return '<could not read the serve log>'
  const content = (await tail.stdout()).trim()
  return content.length > 0 ? content : '<serve log is empty or missing>'
}

export type ServeLauncher = (sandbox: Sandbox) => Promise<void>

export function createServeLauncher(args: {
  readStamp: () => Promise<string>
}): ServeLauncher {
  return async (sandbox) => {
    const stamp = await args.readStamp()
    const [healthy, installed] = await Promise.all([serveHealthy(sandbox), installedHash(sandbox)])
    if (healthy && installed === stamp) return

    if (installed !== stamp) {
      const downloaded = await sh({ sandbox, script: downloadBinary, timeoutMs: DOWNLOAD_TIMEOUT_MS })
      if (downloaded.exitCode === EXIT_AUTH_STALE) throw new StaleSandboxTokenError()
      if (downloaded.exitCode !== 0) {
        throw new Error(
          `downloading atlas serve into the sandbox failed: ${await downloaded.stderr()}`,
        )
      }
    }

    await sh({ sandbox, script: KILL_WEDGED_SERVE, timeoutMs: QUICK_COMMAND_TIMEOUT_MS })

    await sandbox.runCommand({
      cmd: 'sh',
      args: [
        '-c',
        `exec flock -n ${SERVE_LOCK_PATH} ${SERVE_BINARY_PATH} >> ${SERVE_LOG_PATH} 2>&1`,
      ],
      detached: true,
    })

    const waited = await sh({
      sandbox,
      script: `for i in $(seq ${HEALTH_ATTEMPTS}); do ${HEALTH_PROBE} && exit 0; sleep ${HEALTH_INTERVAL_SECONDS}; done; exit 1`,
      timeoutMs: HEALTH_WAIT_TIMEOUT_MS,
    })
    if (waited.exitCode !== 0) {
      const tail = await serveLogTail(sandbox)
      throw new Error(
        `atlas serve did not answer /v1/health within ${HEALTH_ATTEMPTS * HEALTH_INTERVAL_SECONDS}s; its log is at ${SERVE_LOG_PATH} in the sandbox, tail:\n${tail}`,
      )
    }
  }
}
