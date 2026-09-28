import type { Sandbox } from '@vercel/sandbox'

import {
  SERVE_BINARY_PATH,
  SERVE_HOME,
  SERVE_LOCK_PATH,
  SERVE_LOG_PATH,
  SERVE_TOKEN_PATH,
  SERVE_VERSION_PATH,
} from '@dltech/atlas-wire'

export {
  SERVE_BINARY_PATH,
  SERVE_HOME,
  SERVE_LOCK_PATH,
  SERVE_LOG_PATH,
  SERVE_TOKEN_PATH,
  SERVE_VERSION_PATH,
}

const HEALTH_ATTEMPTS = 90
const HEALTH_INTERVAL_SECONDS = 2
const HEALTH_WAIT_TIMEOUT_MS = (HEALTH_ATTEMPTS * HEALTH_INTERVAL_SECONDS + 30) * 1000
const QUICK_COMMAND_TIMEOUT_MS = 15_000

const withServeToken = (script: string): string =>
  `_serve_token=$(cat ${SERVE_TOKEN_PATH} 2>/dev/null || true); ` +
  `[ -n "$_serve_token" ] && export ATLAS_SERVE_TOKEN="$_serve_token"; true; ${script}`

export const HEALTH_PROBE = withServeToken(
  `curl -sf -m 5 --connect-timeout 2 -H "Authorization: Bearer $ATLAS_SERVE_TOKEN" "http://localhost:$ATLAS_SERVE_PORT/v1/health" -o /dev/null`,
)

const sh = (args: {
  sandbox: Sandbox
  script: string
  timeoutMs?: number
  env?: Record<string, string>
}) =>
  args.sandbox.runCommand({
    cmd: 'sh',
    args: ['-c', args.script],
    ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
    ...(args.env === undefined ? {} : { env: args.env }),
  })

const serveHealthy = async (sandbox: Sandbox): Promise<boolean> =>
  (await sh({ sandbox, script: HEALTH_PROBE, timeoutMs: QUICK_COMMAND_TIMEOUT_MS })).exitCode === 0

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

export type ServeLauncher = (args: { sandbox: Sandbox; token?: string }) => Promise<void>

/**
 * Boots the serve the sandbox's image baked in. There is no freshness negotiation: the driver
 * pins the image to this build's release and recreates a sandbox whose baked serve predates the
 * pin before this runs, so the serve on board is the right one by construction. What remains is
 * liveness — a healthy serve answers, a wedged one is killed and relaunched.
 */
export function createServeLauncher(): ServeLauncher {
  return async ({ sandbox, token }) => {
    if (token !== undefined) {
      await sh({
        sandbox,
        script: `mkdir -p ${SERVE_HOME}`,
        timeoutMs: QUICK_COMMAND_TIMEOUT_MS,
      })
      await sandbox.writeFiles([{ path: SERVE_TOKEN_PATH, content: token, mode: 0o600 }])
    }
    if (await serveHealthy(sandbox)) return

    await sh({ sandbox, script: KILL_WEDGED_SERVE, timeoutMs: QUICK_COMMAND_TIMEOUT_MS })

    await sandbox.runCommand({
      cmd: 'sh',
      args: [
        '-c',
        withServeToken(
          `exec flock -n ${SERVE_LOCK_PATH} ${SERVE_BINARY_PATH} >> ${SERVE_LOG_PATH} 2>&1`,
        ),
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
