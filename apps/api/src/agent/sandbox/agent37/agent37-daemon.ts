import { createHash } from 'node:crypto'
import { dirname } from 'node:path'

import { SANDBOX_HOME_PATH, SANDBOX_SERVE_PORT } from '../constants'

import type { Agent37Client, Agent37ExecResult } from './agent37-client'

const DAEMON_HOME = `${SANDBOX_HOME_PATH}/.atlas/daemon`
const DAEMON_BUNDLE_PATH = `${DAEMON_HOME}/daemon.js`
const DAEMON_VERSION_PATH = `${DAEMON_HOME}/version`
const DAEMON_PID_PATH = `${DAEMON_HOME}/daemon.pid`
const DAEMON_LOCK_PATH = `${DAEMON_HOME}/daemon.lock`
const DAEMON_LOG_PATH = `${DAEMON_HOME}/daemon.log`
const DAEMON_STAGING_PATH = `${DAEMON_HOME}/daemon.b64`

const BUN_PATH = '/opt/mise/shims/bun'
const DAEMON_PORT = String(SANDBOX_SERVE_PORT)
const DEFAULT_LISTEN_BUDGET_MS = 30_000
const LISTEN_POLL_MS = 500
// https://www.agent37.com/docs/agents-api/exec — a request body is capped at 1 MB, so the bundle
// rides to the instance in base64 chunks well under that.
const UPLOAD_CHUNK_CHARS = 100_000

const LISTEN_PROBE = `curl -s localhost:${DAEMON_PORT} | grep -qx atlas-daemon`
const ALIVE_PROBE = `[ -f ${DAEMON_PID_PATH} ] && kill -0 "$(cat ${DAEMON_PID_PATH})" 2>/dev/null && echo alive || true`

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const outputOf = (answer: Agent37ExecResult | { pid: number }): Agent37ExecResult | undefined =>
  'exit_code' in answer ? answer : undefined

export const agent37Exec = async (args: {
  client: Agent37Client
  instanceId: string
  command: string
  background?: boolean
}): Promise<Agent37ExecResult | undefined> => {
  const answer = await args.client.exec({
    id: args.instanceId,
    command: args.command,
    ...(args.background === undefined ? {} : { background: args.background }),
  })
  return outputOf(answer)
}

const sh = async (args: {
  client: Agent37Client
  instanceId: string
  command: string
}): Promise<string> => (await agent37Exec(args))?.stdout ?? ''

const readVersion = async (args: {
  client: Agent37Client
  instanceId: string
}): Promise<string | undefined> => {
  const trimmed = (await sh({ ...args, command: `cat ${DAEMON_VERSION_PATH} 2>/dev/null` })).trim()
  return trimmed === '' ? undefined : trimmed
}

const isAlive = async (args: { client: Agent37Client; instanceId: string }): Promise<boolean> =>
  (await sh({ ...args, command: ALIVE_PROBE })).trim() === 'alive'

const isListening = async (args: {
  client: Agent37Client
  instanceId: string
}): Promise<boolean> => {
  const answer = await agent37Exec({ ...args, command: LISTEN_PROBE })
  return answer !== undefined && answer.exit_code === 0
}

const logTail = async (args: { client: Agent37Client; instanceId: string }): Promise<string> =>
  sh({ ...args, command: `tail -n 40 ${DAEMON_LOG_PATH} 2>/dev/null` })

const waitForListen = async (args: {
  client: Agent37Client
  instanceId: string
  budgetMs: number
}): Promise<void> => {
  const deadline = Date.now() + args.budgetMs
  while (Date.now() < deadline) {
    if (await isListening(args)) return
    await sleep(LISTEN_POLL_MS)
  }
  const tail = await logTail(args)
  throw new Error(
    `agent37 instance ${args.instanceId} daemon did not answer atlas-daemon on port ${DAEMON_PORT} within ${Math.floor(args.budgetMs / 1000)}s; tail of ${DAEMON_LOG_PATH}:\n${tail}`,
  )
}

const uploadBundle = async (args: {
  client: Agent37Client
  instanceId: string
  content: string
  log?: ((line: string) => void) | undefined
}): Promise<void> => {
  const encoded = Buffer.from(Bun.gzipSync(Buffer.from(args.content, 'utf8'))).toString('base64')
  await sh({
    client: args.client,
    instanceId: args.instanceId,
    command: `mkdir -p ${dirname(DAEMON_STAGING_PATH)} && : > ${DAEMON_STAGING_PATH}`,
  })
  const chunks = Math.ceil(encoded.length / UPLOAD_CHUNK_CHARS)
  args.log?.(`agent37 instance ${args.instanceId} uploading the daemon bundle in ${chunks} chunks`)
  for (let offset = 0; offset < encoded.length; offset += UPLOAD_CHUNK_CHARS) {
    const chunk = encoded.slice(offset, offset + UPLOAD_CHUNK_CHARS)
    await sh({
      client: args.client,
      instanceId: args.instanceId,
      command: `printf %s '${chunk}' >> ${DAEMON_STAGING_PATH}`,
    })
  }
}

export type Agent37DaemonBundle = { path: string }

export const launchAgent37Daemon = async (args: {
  client: Agent37Client
  instanceId: string
  bundle: Agent37DaemonBundle
  token: string
  sandboxName: string
  log?: ((line: string) => void) | undefined
  listenBudgetMs?: number | undefined
}): Promise<void> => {
  const { client, instanceId } = args
  const content = await Bun.file(args.bundle.path).text()
  const version = createHash('sha256').update(content).digest('hex')
  const [stored, alive] = await Promise.all([
    readVersion({ client, instanceId }),
    isAlive({ client, instanceId }),
  ])
  if (alive && stored === version) {
    args.log?.(
      `agent37 instance ${instanceId} has a live daemon at version ${version} — keeping it`,
    )
    await waitForListen({
      client,
      instanceId,
      budgetMs: args.listenBudgetMs ?? DEFAULT_LISTEN_BUDGET_MS,
    })
    return
  }
  if (alive) {
    args.log?.(`agent37 instance ${instanceId} runs daemon "${stored ?? 'none'}" — killing it`)
    await sh({
      client,
      instanceId,
      command: `kill "$(cat ${DAEMON_PID_PATH})" 2>/dev/null; sleep 0.5; kill -9 "$(cat ${DAEMON_PID_PATH})" 2>/dev/null || true`,
    })
  }

  await uploadBundle({
    client,
    instanceId,
    content,
    ...(args.log === undefined ? {} : { log: args.log }),
  })
  await sh({
    client,
    instanceId,
    command: `base64 -d ${DAEMON_STAGING_PATH} | gunzip > ${DAEMON_BUNDLE_PATH} && rm -f ${DAEMON_STAGING_PATH} && printf %s '${version}' > ${DAEMON_VERSION_PATH}`,
  })

  args.log?.(`agent37 instance ${instanceId} has no matching daemon — booting it under the flock`)
  await agent37Exec({
    client,
    instanceId,
    background: true,
    command: `mkdir -p ${dirname(DAEMON_LOG_PATH)} && : >> ${DAEMON_LOG_PATH} && exec flock -w 5 ${DAEMON_LOCK_PATH} sh -c 'echo $$ > ${DAEMON_PID_PATH}; exec ${BUN_PATH} ${DAEMON_BUNDLE_PATH}' >> ${DAEMON_LOG_PATH} 2>&1`,
  })

  await waitForListen({
    client,
    instanceId,
    budgetMs: args.listenBudgetMs ?? DEFAULT_LISTEN_BUDGET_MS,
  })
  args.log?.(`agent37 instance ${instanceId} daemon is listening on ${DAEMON_PORT}`)
}

export const agent37DaemonPaths = {
  home: DAEMON_HOME,
  bundle: DAEMON_BUNDLE_PATH,
  version: DAEMON_VERSION_PATH,
  pid: DAEMON_PID_PATH,
  log: DAEMON_LOG_PATH,
} as const
