import type { Sandbox } from '@vercel/sandbox'

import { DRIVE_HOME_PATH } from './drive-names'
import {
  SERVE_BINARY_PATH,
  SERVE_HOME,
  SERVE_LOCK_PATH,
  SERVE_LOG_PATH,
  SERVE_PROTOCOL_PATH,
  SERVE_TOKEN_PATH,
  SERVE_VERSION_PATH,
} from '@dltech/atlas-wire'

export {
  SERVE_BINARY_PATH,
  SERVE_HOME,
  SERVE_LOCK_PATH,
  SERVE_LOG_PATH,
  SERVE_PROTOCOL_PATH,
  SERVE_TOKEN_PATH,
  SERVE_VERSION_PATH,
}

export const SERVE_CHECKPOINT_PATH = `${DRIVE_HOME_PATH}/operational/runtime-checkpoint.json`

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

const serveAlive = async (sandbox: Sandbox): Promise<boolean> => {
  const probe = await sh({
    sandbox,
    script: `kill -0 $(cat ${SERVE_HOME}/atlas-serve.pid 2>/dev/null) 2>/dev/null || { for pid in /proc/[0-9]*; do grep -qa '^${SERVE_BINARY_PATH}' "$pid/cmdline" 2>/dev/null && exit 0; done; exit 1; }`,
    timeoutMs: QUICK_COMMAND_TIMEOUT_MS,
  }).catch(() => null)
  return probe === null || probe.exitCode === 0
}

const tokenFileMatches = async (args: { sandbox: Sandbox; token: string }): Promise<boolean> => {
  const probe = await sh({
    sandbox: args.sandbox,
    script: `[ ! -s ${SERVE_TOKEN_PATH} ] || [ "$(cat ${SERVE_TOKEN_PATH} 2>/dev/null)" = "$ATLAS_SERVE_TOKEN" ]`,
    env: { ATLAS_SERVE_TOKEN: args.token },
    timeoutMs: QUICK_COMMAND_TIMEOUT_MS,
  }).catch(() => null)
  return probe !== null && probe.exitCode === 0
}

const parkedCheckpointNames = async (args: {
  sandbox: Sandbox
  sandboxSessionId: string | undefined
}): Promise<boolean> => {
  if (args.sandboxSessionId === undefined) return false
  const probe = await sh({
    sandbox: args.sandbox,
    script:
      `test -f ${SERVE_CHECKPOINT_PATH} && ` +
      `grep -q '"phase"[[:space:]]*:[[:space:]]*"parked"' ${SERVE_CHECKPOINT_PATH} && ` +
      `grep -q '"sandboxSessionId"[[:space:]]*:[[:space:]]*"${args.sandboxSessionId}"' ${SERVE_CHECKPOINT_PATH} && exit 42; exit 0`,
    timeoutMs: QUICK_COMMAND_TIMEOUT_MS,
  })
  return probe.exitCode === 42
}

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

const waitForHealth = async (sandbox: Sandbox): Promise<boolean> =>
  (
    await sh({
      sandbox,
      script: `for i in $(seq ${HEALTH_ATTEMPTS}); do ${HEALTH_PROBE} && exit 0; sleep ${HEALTH_INTERVAL_SECONDS}; done; exit 1`,
      timeoutMs: HEALTH_WAIT_TIMEOUT_MS,
    })
  ).exitCode === 0

export type ServeLauncher = (args: {
  sandbox: Sandbox
  token?: string | undefined
  sandboxSessionId?: string | undefined
  cloudUrl?: string | undefined
}) => Promise<void>

export function createServeLauncher(args?: {
  log?: ((line: string) => void) | undefined
}): ServeLauncher {
  return async ({ sandbox, token, sandboxSessionId, cloudUrl }) => {
    if (await serveAlive(sandbox)) {
      if (token !== undefined && !(await tokenFileMatches({ sandbox, token }))) {
        throw new Error('atlas serve is already running under a different token; refusing to rotate its live credentials')
      }
      if (await serveHealthy(sandbox)) {
        args?.log?.(`sandbox ${sandbox.name} has a live serve answering /v1/health — keeping it`)
        return
      }
      args?.log?.(
        `sandbox ${sandbox.name} has a live serve that is not answering /v1/health — the process is preserved rather than killed; waiting for it`,
      )
      if (!(await waitForHealth(sandbox))) {
        const tail = await serveLogTail(sandbox)
        throw new Error(
          `atlas serve is running but did not answer /v1/health within ${HEALTH_ATTEMPTS * HEALTH_INTERVAL_SECONDS}s; the live process was preserved rather than killed, and its log is at ${SERVE_LOG_PATH} in the sandbox, tail:\n${tail}`,
        )
      }
      return
    }

    if (
      await parkedCheckpointNames({ sandbox, sandboxSessionId })
    ) {
      throw new Error(
        `sandbox ${sandbox.name} holds a checkpoint that parked this very session ${sandboxSessionId ?? ''} — refusing to boot a new serve over its park proof`,
      )
    }

    if (token !== undefined) {
      await sh({
        sandbox,
        script: `mkdir -p ${SERVE_HOME}`,
        timeoutMs: QUICK_COMMAND_TIMEOUT_MS,
      })
      await sandbox.writeFiles([{ path: SERVE_TOKEN_PATH, content: token, mode: 0o600 }])
    }

    if (await serveHealthy(sandbox)) {
      args?.log?.(`sandbox ${sandbox.name} has a serve answering /v1/health — keeping it`)
      return
    }

    args?.log?.(`sandbox ${sandbox.name} has no live serve — booting it under the flock`)
    await sandbox.runCommand({
      cmd: 'sh',
      args: [
        '-c',
        withServeToken(
          `exec flock -n ${SERVE_LOCK_PATH} sh -c 'echo $$ > ${SERVE_HOME}/atlas-serve.pid; exec ${SERVE_BINARY_PATH}' >> ${SERVE_LOG_PATH} 2>&1`,
        ),
      ],
      detached: true,
      env: {
        ...(sandboxSessionId === undefined ? {} : { ATLAS_SANDBOX_SESSION_ID: sandboxSessionId }),
        ...(cloudUrl === undefined ? {} : { ATLAS_CLOUD_URL: cloudUrl }),
      },
    })

    if (!(await waitForHealth(sandbox))) {
      const tail = await serveLogTail(sandbox)
      throw new Error(
        `atlas serve did not answer /v1/health within ${HEALTH_ATTEMPTS * HEALTH_INTERVAL_SECONDS}s; its log is at ${SERVE_LOG_PATH} in the sandbox, tail:\n${tail}`,
      )
    }
    args?.log?.(`sandbox ${sandbox.name} answers /v1/health`)
  }
}
