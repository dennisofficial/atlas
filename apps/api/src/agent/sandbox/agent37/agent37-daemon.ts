import { createHash } from 'node:crypto'

import { DAEMON_PORT } from '@dltech/atlas-protocol'

import type { Agent37Client } from './agent37-client'

const DEFAULT_LISTEN_BUDGET_MS = 3 * 60_000
const LISTEN_POLL_MS = 1_000
const READY_POLL_MS = 2_000
const DEFAULT_READY_BUDGET_MS = 2 * 60_000
const RESTART_ACCEPTED = new Set([202, 409])

export type Agent37DaemonBundle = { path: string }

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export const agent37BundleVersionOf = async (path: string): Promise<string> =>
  createHash('sha256')
    .update(await Bun.file(path).text())
    .digest('hex')

// https://www.agent37.com/docs/agents-api/exec — a fresh instance can report `running` before its
// ports answer, so reachability is read off the routed URL rather than an exec.
export const waitForAgent37Instance = async (args: {
  client: Agent37Client
  instanceId: string
  budgetMs?: number | undefined
  log?: ((line: string) => void) | undefined
}): Promise<void> => {
  const budgetMs = args.budgetMs ?? DEFAULT_READY_BUDGET_MS
  const deadline = Date.now() + budgetMs
  let status = 'unknown'
  for (;;) {
    const instance = await args.client.get({ id: args.instanceId })
    status = instance.status
    if (status === 'running') {
      args.log?.(`agent37 instance ${args.instanceId} is running`)
      return
    }
    if (status === 'stopped') break
    if (Date.now() >= deadline) break
    await sleep(READY_POLL_MS)
  }
  throw new Error(
    `agent37 instance ${args.instanceId} did not reach a running status within ${Math.floor(
      budgetMs / 1000,
    )}s; last status "${status}"`,
  )
}

const daemonVersionOf = async (args: {
  client: Agent37Client
  instanceId: string
}): Promise<string | undefined> => {
  const answer = await args.client.probe({
    id: args.instanceId,
    port: DAEMON_PORT,
    path: '/version',
  })
  if (answer.status !== 200) return undefined
  const body = answer.body.trim()
  return body === '' ? undefined : body
}

const restartDaemon = async (args: {
  client: Agent37Client
  instanceId: string
  token: string
}): Promise<boolean> => {
  const answer = await args.client.probe({
    id: args.instanceId,
    port: DAEMON_PORT,
    path: '/restart',
    method: 'POST',
    authorization: `Bearer ${args.token}`,
  })
  return RESTART_ACCEPTED.has(answer.status)
}

export const waitForAgent37Daemon = async (args: {
  client: Agent37Client
  instanceId: string
  version: string
  token: string
  budgetMs?: number | undefined
  log?: ((line: string) => void) | undefined
}): Promise<void> => {
  const budgetMs = args.budgetMs ?? DEFAULT_LISTEN_BUDGET_MS
  const deadline = Date.now() + budgetMs
  let running: string | undefined
  let restarted = false
  for (;;) {
    running = await daemonVersionOf(args)
    if (running === args.version) {
      args.log?.(`agent37 instance ${args.instanceId} runs daemon ${args.version}`)
      return
    }
    if (running !== undefined && !restarted) {
      args.log?.(
        `agent37 instance ${args.instanceId} runs daemon "${running}", needs "${args.version}" — restarting it`,
      )
      restarted = await restartDaemon(args)
    }
    if (Date.now() >= deadline) break
    await sleep(LISTEN_POLL_MS)
  }
  throw new Error(
    `agent37 instance ${args.instanceId} daemon did not answer version ${args.version} on port ${DAEMON_PORT} within ${Math.floor(
      budgetMs / 1000,
    )}s; last version "${running ?? 'none'}"`,
  )
}
