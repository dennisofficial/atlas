import { createHash } from 'node:crypto'
import { dirname } from 'node:path'

import {
  HEALTH_PROBE,
  SANDBOX_WORKSPACE_PATH,
  SERVE_ALIVE_PROBE,
  SERVE_BINARY_PATH,
  SERVE_HOME,
  SERVE_LOCK_PATH,
  SERVE_LOG_PATH,
  SERVE_PROTOCOL_PATH,
  SERVE_TOKEN_PATH,
  SERVE_VERSION_PATH,
} from '@dltech/atlas-wire'

import { boundedScript, shellQuoted, type PodLog, type PodTarget } from './serve-exec'
import {
  parseInstalledStamps,
  serveDriftedFor,
  serveStaleFor,
  type InstalledStamps,
} from './serve-drift'
import type { PodServeInstaller } from './serve-install'

export type PodServeSwap = { fromVersion: string | undefined; fromProtocol: number }

export type PodServeLauncher = (
  args: PodTarget & {
    token: string
    cloudUrl: string
    desiredVersion: string | undefined
    onSwapStarted?: (() => void) | undefined
  },
) => Promise<{ swapped?: PodServeSwap | undefined }>

const HEALTH_ATTEMPTS = 90
const HEALTH_INTERVAL_SECONDS = 2
const HEALTH_WAIT_SECONDS = HEALTH_ATTEMPTS * HEALTH_INTERVAL_SECONDS + 30
const QUICK_COMMAND_TIMEOUT_MS = 15_000
const SERVE_STOP_SECONDS = 30
const TOKEN_FILE_MODE = 0o600

const withServeToken = (script: string): string =>
  `_serve_token=$(cat ${SERVE_TOKEN_PATH} 2>/dev/null || true); ` +
  `[ -n "$_serve_token" ] && export ATLAS_SERVE_TOKEN="$_serve_token"; true; ${script}`

const STAMPS_SCRIPT =
  `printf '%s\\n' "$(cat ${SERVE_VERSION_PATH} 2>/dev/null)"; ` +
  `printf '%s\\n' "$(cat ${SERVE_PROTOCOL_PATH} 2>/dev/null)"`

const STOP_SCRIPT =
  `_pid=$(cat ${SERVE_HOME}/atlas-serve.pid 2>/dev/null || true); ` +
  `[ -n "$_pid" ] && kill "$_pid" 2>/dev/null || true; ` +
  `for i in $(seq 10); do ` +
  `kill -0 "$_pid" 2>/dev/null || exit 0; sleep 1; ` +
  `done; ` +
  `[ -n "$_pid" ] && kill -9 "$_pid" 2>/dev/null || true; exit 0`

const HEALTH_WAIT_SCRIPT = `for i in $(seq ${HEALTH_ATTEMPTS}); do ${HEALTH_PROBE} && exit 0; sleep ${HEALTH_INTERVAL_SECONDS}; done; exit 1`

const LAUNCH_BODY =
  `(umask 077; mkdir -p ${dirname(SERVE_LOG_PATH)} && : >> ${SERVE_LOG_PATH}) && ` +
  `mkdir -p ${SANDBOX_WORKSPACE_PATH} && cd ${SANDBOX_WORKSPACE_PATH} && ` +
  `exec flock -n ${SERVE_LOCK_PATH} sh -c 'echo $$ > ${SERVE_HOME}/atlas-serve.pid; exec ${SERVE_BINARY_PATH}' >> ${SERVE_LOG_PATH} 2>&1`

const detachedLaunchScript = (cloudUrl: string): string =>
  `export ATLAS_CLOUD_URL=${shellQuoted(cloudUrl)}; ` +
  withServeToken(`setsid nohup sh -c ${shellQuoted(LAUNCH_BODY)} >/dev/null 2>&1 </dev/null &`)

const tokenFenceScript = (token: string): string => {
  const digest = createHash('sha256').update(token).digest('hex')
  return `[ ! -s ${SERVE_TOKEN_PATH} ] || [ "$(sha256sum < ${SERVE_TOKEN_PATH} | awk '{print $1}')" = "${digest}" ]`
}

const quick = (args: { target: PodTarget; script: string }) =>
  args.target.engine.execSh({
    id: args.target.id,
    script: args.script,
    timeoutMs: QUICK_COMMAND_TIMEOUT_MS,
  })

const bounded = (args: { target: PodTarget; script: string; seconds: number }) => {
  const run = boundedScript({ script: args.script, seconds: args.seconds })
  return args.target.engine.execSh({
    id: args.target.id,
    script: run.script,
    timeoutMs: run.timeoutMs,
  })
}

const probeAlive = async (target: PodTarget): Promise<boolean> => {
  const probe = await quick({ target, script: SERVE_ALIVE_PROBE }).catch(() => undefined)
  return probe === undefined || probe.exitCode === 0
}

const tokenFileMatches = async (args: { target: PodTarget; token: string }): Promise<boolean> => {
  const probe = await quick({ target: args.target, script: tokenFenceScript(args.token) }).catch(
    () => undefined,
  )
  return probe !== undefined && probe.exitCode === 0
}

const readStamps = async (target: PodTarget): Promise<InstalledStamps> => {
  const read = await quick({ target, script: STAMPS_SCRIPT }).catch(() => undefined)
  if (read === undefined || read.exitCode !== 0) return parseInstalledStamps('')
  return parseInstalledStamps(await read.stdout())
}

const binaryPresent = async (target: PodTarget): Promise<boolean> => {
  const probe = await quick({ target, script: `test -s ${SERVE_BINARY_PATH}` }).catch(() => undefined)
  return probe !== undefined && probe.exitCode === 0
}

const serveHealthy = async (target: PodTarget): Promise<boolean> =>
  (await quick({ target, script: HEALTH_PROBE })).exitCode === 0

const waitForHealth = async (target: PodTarget): Promise<boolean> => {
  const wait = await bounded({ target, script: HEALTH_WAIT_SCRIPT, seconds: HEALTH_WAIT_SECONDS }).catch(
    () => undefined,
  )
  return wait !== undefined && wait.exitCode === 0
}

const serveLogTail = async (target: PodTarget): Promise<string> => {
  const tail = await quick({
    target,
    script: `tail -c 16384 ${SERVE_LOG_PATH} 2>/dev/null || true`,
  }).catch(() => undefined)
  if (tail === undefined) return '<could not read the serve log>'
  const content = (await tail.stdout()).trim()
  return content.length > 0 ? content : '<serve log is empty or missing>'
}

const stopServe = async (target: PodTarget): Promise<void> => {
  await bounded({ target, script: STOP_SCRIPT, seconds: SERVE_STOP_SECONDS }).catch(() => undefined)
}

const describedStamps = (stamps: InstalledStamps): string =>
  `"${stamps.version ?? 'none'}" (protocol ${stamps.protocol})`

export function createPodServeLauncher(args: {
  install: PodServeInstaller
  log?: PodLog
}): PodServeLauncher {
  const { install, log } = args

  return async ({ engine, id, name, token, cloudUrl, desiredVersion, onSwapStarted }) => {
    const target: PodTarget = { engine, id, name }
    const wanted = `"${desiredVersion ?? 'latest'}"`
    let swapped: PodServeSwap | undefined

    if (await probeAlive(target)) {
      if (!(await tokenFileMatches({ target, token }))) {
        throw new Error(
          'atlas serve is already running under a different token; refusing to rotate its live credentials',
        )
      }
      const stamps = await readStamps(target)
      if (!serveDriftedFor({ stamps, desiredVersion })) {
        if (await serveHealthy(target)) {
          log?.(`pod ${name} has a live serve answering /v1/health — keeping it`)
          return {}
        }
        log?.(
          `pod ${name} has a live serve that is not answering /v1/health — the process is preserved rather than killed; waiting for it`,
        )
        if (!(await waitForHealth(target))) {
          const tail = await serveLogTail(target)
          throw new Error(
            `atlas serve is running but did not answer /v1/health within ${HEALTH_ATTEMPTS * HEALTH_INTERVAL_SECONDS}s; the live process was preserved rather than killed, and its log is at ${SERVE_LOG_PATH} in the pod, tail:\n${tail}`,
          )
        }
        return {}
      }
      log?.(
        `pod ${name} runs serve ${describedStamps(stamps)}, stale against ${wanted} — downloading the replacement first so a failed download leaves it serving`,
      )
      await install({ engine, id, name, version: desiredVersion, log })
      onSwapStarted?.()
      log?.(
        `pod ${name} carries serve ${describedStamps(stamps)}, needs ${wanted} — stopping it to swap in place`,
      )
      await stopServe(target)
      if (await probeAlive(target)) {
        throw new Error(
          'atlas serve refused to stop for its in-place swap; the pod was left running the old serve rather than destroyed',
        )
      }
      swapped = { fromVersion: stamps.version, fromProtocol: stamps.protocol }
    }

    await quick({ target, script: `mkdir -p ${SERVE_HOME}` })
    await engine.writeFile({ id, path: SERVE_TOKEN_PATH, content: token, mode: TOKEN_FILE_MODE })

    if (await serveHealthy(target)) {
      log?.(`pod ${name} has a serve answering /v1/health — keeping it`)
      return { swapped }
    }

    const present = await binaryPresent(target)
    const stamps = await readStamps(target)
    if (serveStaleFor({ present, stamps, desiredVersion })) {
      log?.(
        `pod ${name} carries serve ${describedStamps(stamps)}, needs ${wanted} — downloading it in place`,
      )
      await install({ engine, id, name, version: desiredVersion, log })
    }

    log?.(`pod ${name} has no live serve — booting it under the flock`)
    await quick({ target, script: detachedLaunchScript(cloudUrl) })

    if (!(await waitForHealth(target))) {
      const tail = await serveLogTail(target)
      throw new Error(
        `atlas serve did not answer /v1/health within ${HEALTH_ATTEMPTS * HEALTH_INTERVAL_SECONDS}s; its log is at ${SERVE_LOG_PATH} in the pod, tail:\n${tail}`,
      )
    }
    log?.(`pod ${name} answers /v1/health`)
    return { swapped }
  }
}
