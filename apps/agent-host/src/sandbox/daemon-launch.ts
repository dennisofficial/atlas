import { createHash } from 'node:crypto'
import { dirname } from 'node:path'

import type { Sandbox } from '@vercel/sandbox'
import { SANDBOX_HOME_PATH, SANDBOX_SERVE_PORT } from './constants'
import { sandboxSh } from './sandbox-sh'

const DAEMON_HOME = `${SANDBOX_HOME_PATH}/.atlas/daemon`
const DAEMON_BUNDLE_PATH = `${DAEMON_HOME}/daemon.js`
const DAEMON_VERSION_PATH = `${DAEMON_HOME}/version`
const DAEMON_PID_PATH = `${DAEMON_HOME}/daemon.pid`
const DAEMON_LOCK_PATH = `${DAEMON_HOME}/daemon.lock`
const DAEMON_LOG_PATH = `${DAEMON_HOME}/daemon.log`

const BUN_PATH = '/opt/mise/shims/bun'
const DAEMON_PORT = String(SANDBOX_SERVE_PORT)
const QUICK_COMMAND_TIMEOUT_MS = 15_000
const DEFAULT_LISTEN_BUDGET_MS = 30_000
const LISTEN_POLL_MS = 500

const LISTEN_PROBE = `curl -s localhost:${DAEMON_PORT} | grep -qx atlas-daemon`
const ALIVE_PROBE = `[ -f ${DAEMON_PID_PATH} ] && kill -0 "$(cat ${DAEMON_PID_PATH})" 2>/dev/null`
const KILL_SCRIPT = `kill "$(cat ${DAEMON_PID_PATH})" 2>/dev/null; for i in $(seq 1 20); do kill -0 "$(cat ${DAEMON_PID_PATH})" 2>/dev/null || break; sleep 0.25; done; kill -9 "$(cat ${DAEMON_PID_PATH})" 2>/dev/null || true`

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const sh = async (args: { sandbox: Sandbox; script: string }): Promise<string> => {
  const run = await sandboxSh({
    sandbox: args.sandbox,
    script: args.script,
    timeoutMs: QUICK_COMMAND_TIMEOUT_MS,
  })
  if (typeof run.stdout !== 'function') return ''
  return run.stdout()
}

const logTail = async (sandbox: Sandbox): Promise<string> =>
  sh({ sandbox, script: `tail -n 40 ${DAEMON_LOG_PATH} 2>/dev/null` })

const readVersion = async (sandbox: Sandbox): Promise<string | undefined> => {
  const out = await sh({ sandbox, script: `cat ${DAEMON_VERSION_PATH} 2>/dev/null` })
  const trimmed = out.trim()
  return trimmed === '' ? undefined : trimmed
}

const isAlive = async (sandbox: Sandbox): Promise<boolean> => {
  const run = await sandboxSh({
    sandbox,
    script: `(${ALIVE_PROBE}) && echo alive || true`,
    timeoutMs: QUICK_COMMAND_TIMEOUT_MS,
  })
  if (typeof run.stdout !== 'function') return false
  return (await run.stdout()).trim() === 'alive'
}

const isListening = async (sandbox: Sandbox): Promise<boolean> => {
  const run = await sandboxSh({
    sandbox,
    script: LISTEN_PROBE,
    timeoutMs: QUICK_COMMAND_TIMEOUT_MS,
  })
  return run.exitCode === 0
}

const waitForListen = async (args: { sandbox: Sandbox; budgetMs: number }): Promise<void> => {
  const deadline = Date.now() + args.budgetMs
  while (Date.now() < deadline) {
    if (await isListening(args.sandbox)) return
    await sleep(LISTEN_POLL_MS)
  }
  const tail = await logTail(args.sandbox)
  throw new Error(
    `sandbox daemon did not answer atlas-daemon on port ${DAEMON_PORT} within ${Math.floor(args.budgetMs / 1000)}s; its log is at ${DAEMON_LOG_PATH} in the sandbox, tail:\n${tail}`,
  )
}

export type DaemonBundle = { path: string }

export const launchDaemon = async (args: {
  sandbox: Sandbox
  bundle: DaemonBundle
  token: string
  sandboxName: string
  log?: ((line: string) => void) | undefined
  listenBudgetMs?: number | undefined
}): Promise<void> => {
  const { sandbox, bundle, token } = args
  const content = await Bun.file(bundle.path).text()
  const version = createHash('sha256').update(content).digest('hex')
  const [stored, alive] = await Promise.all([readVersion(sandbox), isAlive(sandbox)])
  if (alive && stored === version) {
    args.log?.(`sandbox ${sandbox.name} has a live daemon at version ${version} — keeping it`)
    await waitForListen({ sandbox, budgetMs: args.listenBudgetMs ?? DEFAULT_LISTEN_BUDGET_MS })
    return
  }
  if (alive) {
    args.log?.(
      `sandbox ${sandbox.name} runs daemon "${stored ?? 'none'}", needs "${version}" — restarting it`,
    )
    await sh({ sandbox, script: KILL_SCRIPT })
  }

  await sandbox.writeFiles([
    { path: DAEMON_BUNDLE_PATH, content },
    { path: DAEMON_VERSION_PATH, content: version },
  ])

  args.log?.(`sandbox ${sandbox.name} has no matching daemon — booting it under the flock`)
  await sandbox.runCommand({
    cmd: 'sh',
    args: [
      '-c',
      `mkdir -p ${dirname(DAEMON_LOG_PATH)} && : >> ${DAEMON_LOG_PATH} && exec flock -w 5 ${DAEMON_LOCK_PATH} sh -c 'echo $$ > ${DAEMON_PID_PATH}; exec ${BUN_PATH} ${DAEMON_BUNDLE_PATH}' >> ${DAEMON_LOG_PATH} 2>&1`,
    ],
    detached: true,
    env: {
      DAEMON_TOKEN: token,
      ATLAS_SANDBOX_NAME: args.sandboxName,
      PORT: DAEMON_PORT,
    },
  })

  await waitForListen({ sandbox, budgetMs: args.listenBudgetMs ?? DEFAULT_LISTEN_BUDGET_MS })
  args.log?.(`sandbox ${sandbox.name} daemon is listening on ${DAEMON_PORT}`)
}

export const daemonPaths = {
  home: DAEMON_HOME,
  bundle: DAEMON_BUNDLE_PATH,
  version: DAEMON_VERSION_PATH,
  pid: DAEMON_PID_PATH,
  log: DAEMON_LOG_PATH,
} as const
