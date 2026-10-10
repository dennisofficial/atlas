import { dirname } from 'node:path'
import type { Sandbox } from '@vercel/sandbox'

import { CHANNEL_PROTOCOL_VERSION } from './channel-wire.js'
import { installServe, type ServeInstaller } from './sandbox-serve-install.js'
import { sandboxSh, withSwapLock } from './sandbox-swap-lock.js'
import {
  SERVE_BINARY_PATH,
  LEGACY_SERVE_LOG_PATH,
  SERVE_HOME,
  SERVE_LOCK_PATH,
  SERVE_LOG_PATH,
  SERVE_PROTOCOL_PATH,
  SERVE_TOKEN_PATH,
  SERVE_VERSION_PATH,
} from './serve-env.js'

export const UNSTAMPED_PROTOCOL = 0

type InstalledStamps = { version: string | undefined; protocol: number }

const installedStampsOf = async (sandbox: Sandbox): Promise<InstalledStamps> => {
  const read = await sh({
    sandbox,
    script: `printf '%s\\n' "$(cat ${SERVE_VERSION_PATH} 2>/dev/null)"; printf '%s\\n' "$(cat ${SERVE_PROTOCOL_PATH} 2>/dev/null)"`,
    timeoutMs: QUICK_COMMAND_TIMEOUT_MS,
  }).catch(() => null)
  if (read === null || read.exitCode !== 0 || typeof read.stdout !== 'function') {
    return { version: undefined, protocol: UNSTAMPED_PROTOCOL }
  }
  const [versionLine, protocolLine] = (await read.stdout()).split('\n')
  const version = (versionLine ?? '').trim()
  const protocolText = (protocolLine ?? '').trim()
  return {
    version: version === '' ? undefined : version,
    protocol: /^\d+$/.test(protocolText) ? Number(protocolText) : UNSTAMPED_PROTOCOL,
  }
}

const serveStaleFor = (args: {
  present: boolean
  stamps: InstalledStamps
  desiredVersion: string | undefined
}): boolean => {
  if (!args.present) return true
  return serveDriftedFor(args) || args.stamps.version !== args.desiredVersion
}

// Stopping a live serve needs positive drift evidence: a stamped protocol mismatch, or a stamped
// version the pin disagrees with. An unstamped or unreadable stamp predates stamping and a wedged
// process is preserved and waited on, never killed on suspicion.
const serveDriftedFor = (args: {
  stamps: InstalledStamps
  desiredVersion: string | undefined
}): boolean => {
  if (args.stamps.protocol !== UNSTAMPED_PROTOCOL && args.stamps.protocol !== CHANNEL_PROTOCOL_VERSION) return true
  if (args.desiredVersion === undefined) return false
  return args.stamps.version !== undefined && args.stamps.version !== args.desiredVersion
}

const serveBinaryPresent = async (sandbox: Sandbox): Promise<boolean> => {
  const probe = await sh({
    sandbox,
    script: `test -x ${SERVE_BINARY_PATH}`,
    timeoutMs: QUICK_COMMAND_TIMEOUT_MS,
  }).catch(() => null)
  return probe !== null && probe.exitCode === 0
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

const sh = sandboxSh

const serveHealthy = async (sandbox: Sandbox): Promise<boolean> =>
  (await sh({ sandbox, script: HEALTH_PROBE, timeoutMs: QUICK_COMMAND_TIMEOUT_MS })).exitCode === 0

export const SERVE_ALIVE_PROBE = `kill -0 $(cat ${SERVE_HOME}/atlas-serve.pid 2>/dev/null) 2>/dev/null || { for pid in /proc/[0-9]*; do grep -qa '^${SERVE_BINARY_PATH}' "$pid/cmdline" 2>/dev/null && exit 0; done; exit 1; }`

export const probeServeAlive = async (sandbox: Sandbox): Promise<boolean> => {
  const probe = await sh({
    sandbox,
    script: SERVE_ALIVE_PROBE,
    timeoutMs: QUICK_COMMAND_TIMEOUT_MS,
  }).catch(() => null)
  return probe === null || probe.exitCode === 0
}

const serveAlive = probeServeAlive

const SERVE_STOP_TIMEOUT_MS = 30_000

const stopServe = async (sandbox: Sandbox): Promise<void> => {
  await sh({
    sandbox,
    script:
      `_pid=$(cat ${SERVE_HOME}/atlas-serve.pid 2>/dev/null || true); ` +
      `[ -n "$_pid" ] && kill "$_pid" 2>/dev/null || true; ` +
      `for i in $(seq 10); do ` +
      `kill -0 "$_pid" 2>/dev/null || exit 0; sleep 1; ` +
      `done; ` +
      `[ -n "$_pid" ] && kill -9 "$_pid" 2>/dev/null || true; exit 0`,
    timeoutMs: SERVE_STOP_TIMEOUT_MS,
  }).catch(() => null)
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

const serveLogTail = async (sandbox: Sandbox): Promise<string> => {
  const tail = await sh({
    sandbox,
    script: `tail -c 16384 ${SERVE_LOG_PATH} 2>/dev/null || tail -c 16384 ${LEGACY_SERVE_LOG_PATH} 2>/dev/null || true`,
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
  desiredVersion?: string | undefined
}) => Promise<void>

export function createServeLauncher(args?: {
  log?: ((line: string) => void) | undefined
  installServe?: ServeInstaller | undefined
}): ServeLauncher {
  const install = args?.installServe ?? installServe
  const launchUnlocked: ServeLauncher = async ({ sandbox, token, sandboxSessionId, cloudUrl, desiredVersion }) => {
    if (await serveAlive(sandbox)) {
      if (token !== undefined && !(await tokenFileMatches({ sandbox, token }))) {
        throw new Error('atlas serve is already running under a different token; refusing to rotate its live credentials')
      }
      const stamps = await installedStampsOf(sandbox)
      const drifted = serveDriftedFor({ stamps, desiredVersion })
      if (!drifted) {
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
      args?.log?.(
        `sandbox ${sandbox.name} runs serve "${stamps.version ?? 'none'}" (protocol ${stamps.protocol}), stale against "${desiredVersion ?? 'latest'}" — downloading the replacement first so a failed download leaves it serving`,
      )
      await install({ sandbox, version: desiredVersion, log: args?.log })
      args?.log?.(
        `sandbox ${sandbox.name} carries serve "${stamps.version ?? 'none'}" (protocol ${stamps.protocol}), needs "${desiredVersion ?? 'latest'}" — stopping it to swap in place`,
      )
      await stopServe(sandbox)
      if (await serveAlive(sandbox)) {
        throw new Error(
          `atlas serve refused to stop for its in-place swap; the sandbox was left running the old serve rather than destroyed`,
        )
      }
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

    const present = await serveBinaryPresent(sandbox)
    const stamps = await installedStampsOf(sandbox)
    if (serveStaleFor({ present, stamps, desiredVersion })) {
      args?.log?.(
        `sandbox ${sandbox.name} carries serve "${stamps.version ?? 'none'}" (protocol ${stamps.protocol}), needs "${desiredVersion ?? 'latest'}" — downloading it in place`,
      )
      await install({ sandbox, version: desiredVersion, log: args?.log })
    }

    args?.log?.(`sandbox ${sandbox.name} has no live serve — booting it under the flock`)
    await sandbox.runCommand({
      cmd: 'sh',
      args: [
        '-c',
        withServeToken(
          `(umask 077; mkdir -p ${dirname(SERVE_LOG_PATH)} && : >> ${SERVE_LOG_PATH}) && exec flock -n ${SERVE_LOCK_PATH} sh -c 'echo $$ > ${SERVE_HOME}/atlas-serve.pid; exec ${SERVE_BINARY_PATH}' >> ${SERVE_LOG_PATH} 2>&1`,
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
  // Two clients waking the same sandbox race probe→install→boot; the loser re-reads the stamps
  // the winner just wrote and keeps the result instead of installing over it.
  return async (launchArgs) =>
    withSwapLock({
      sandbox: launchArgs.sandbox,
      sh,
      run: () => launchUnlocked(launchArgs),
    })
}
