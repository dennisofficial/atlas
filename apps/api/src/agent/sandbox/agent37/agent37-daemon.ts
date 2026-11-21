import { createHash } from 'node:crypto'

import {
  DAEMON_LINK_PROTOCOL_MIN_VERSION,
  DAEMON_LINK_PROTOCOL_VERSION,
  DAEMON_MIN_PROTOCOL_HEADER,
  DAEMON_PORT,
  DAEMON_PROTOCOL_HEADER,
} from '@dltech/atlas-protocol'

import type { Agent37Client } from './agent37-client'

const DEFAULT_LISTEN_BUDGET_MS = 3 * 60_000
const LISTEN_POLL_MS = 1_000
const READY_POLL_MS = 2_000
const DEFAULT_READY_BUDGET_MS = 2 * 60_000
const RESTART_ACCEPTED = new Set([202, 409])

export type Agent37DaemonBundle = { path: string }

export enum EDaemonSkew {
  Compatible = 'compatible',
  Restart = 'restart',
  HostTooOld = 'host-too-old',
}

export type Agent37DaemonReport = {
  version: string
  protocol: number | undefined
  minProtocol: number | undefined
}

export type Agent37DaemonWant = {
  version: string
  url: string
  protocol?: number | undefined
  minProtocol?: number | undefined
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export const agent37BundleVersionOf = async (path: string): Promise<string> =>
  createHash('sha256')
    .update(await Bun.file(path).text())
    .digest('hex')

export const pinnedDaemonBundleUrlOf = (args: { url: string; version: string }): string =>
  `${args.url}${args.url.includes('?') ? '&' : '?'}version=${args.version}`

// docs/decisions/0017-wire-protocol-skew.md: the newer side talks down. A daemon that reports a
// protocol range overlapping this host's is served as it is; only a daemon too old for the host (or
// one built before it reported a range) is restarted, and a newer daemon is never downgraded, since
// that downgrade is what let two host generations trade one sandbox back and forth.
export const daemonSkewOf = (args: {
  report: Agent37DaemonReport
  want: Agent37DaemonWant
}): EDaemonSkew => {
  if (args.report.version === args.want.version) return EDaemonSkew.Compatible
  const protocol = args.want.protocol ?? DAEMON_LINK_PROTOCOL_VERSION
  const minProtocol = args.want.minProtocol ?? DAEMON_LINK_PROTOCOL_MIN_VERSION
  const reported = args.report.protocol
  if (reported === undefined) return EDaemonSkew.Restart
  const reportedMin = args.report.minProtocol ?? reported
  if (reportedMin > protocol) return EDaemonSkew.HostTooOld
  if (reported < minProtocol) return EDaemonSkew.Restart
  return EDaemonSkew.Compatible
}

const numberHeaderOf = (headers: Record<string, string> | undefined, name: string): number => {
  const raw = headers?.[name]
  if (raw === undefined) return Number.NaN
  const value = Number(raw)
  return Number.isInteger(value) ? value : Number.NaN
}

const protocolHeaderOf = (headers: Record<string, string> | undefined, name: string) => {
  const value = numberHeaderOf(headers, name)
  return Number.isNaN(value) ? undefined : value
}

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

const daemonReportOf = async (args: {
  client: Agent37Client
  instanceId: string
}): Promise<Agent37DaemonReport | undefined> => {
  const answer = await args.client.probe({
    id: args.instanceId,
    port: DAEMON_PORT,
    path: '/version',
  })
  if (answer.status !== 200) return undefined
  const version = answer.body.trim()
  if (version === '') return undefined
  return {
    version,
    protocol: protocolHeaderOf(answer.headers, DAEMON_PROTOCOL_HEADER),
    minProtocol: protocolHeaderOf(answer.headers, DAEMON_MIN_PROTOCOL_HEADER),
  }
}

const restartDaemon = async (args: {
  client: Agent37Client
  instanceId: string
  token: string
  want: Agent37DaemonWant
}): Promise<boolean> => {
  const answer = await args.client.probe({
    id: args.instanceId,
    port: DAEMON_PORT,
    path: '/restart',
    method: 'POST',
    authorization: `Bearer ${args.token}`,
    body: JSON.stringify({ bundleUrl: args.want.url, bundleVersion: args.want.version }),
  })
  return RESTART_ACCEPTED.has(answer.status)
}

export const waitForAgent37Daemon = async (args: {
  client: Agent37Client
  instanceId: string
  want: Agent37DaemonWant
  token: string
  budgetMs?: number | undefined
  log?: ((line: string) => void) | undefined
}): Promise<void> => {
  const budgetMs = args.budgetMs ?? DEFAULT_LISTEN_BUDGET_MS
  const deadline = Date.now() + budgetMs
  let running: string | undefined
  let restarted = false
  for (;;) {
    const report = await daemonReportOf(args)
    running = report?.version
    if (report !== undefined) {
      const skew = daemonSkewOf({ report, want: args.want })
      if (skew === EDaemonSkew.Compatible) {
        args.log?.(`agent37 instance ${args.instanceId} runs daemon ${report.version}`)
        return
      }
      if (skew === EDaemonSkew.HostTooOld) {
        throw new Error(
          `agent37 instance ${args.instanceId} runs daemon "${report.version}" (protocol ${
            report.protocol ?? 'unknown'
          }–${report.minProtocol ?? 'unknown'}), newer than this host speaks (protocol ${
            args.want.protocol ?? DAEMON_LINK_PROTOCOL_VERSION
          }–${
            args.want.minProtocol ?? DAEMON_LINK_PROTOCOL_MIN_VERSION
          }); leaving it for the host that speaks it`,
        )
      }
      if (!restarted) {
        args.log?.(
          `agent37 instance ${args.instanceId} runs daemon "${report.version}" (protocol ${
            report.protocol ?? 'unknown'
          }–${report.minProtocol ?? 'unknown'}), needs "${
            args.want.version
          }" — restarting it onto that bundle`,
        )
        restarted = await restartDaemon({ ...args, want: args.want })
      }
    }
    if (Date.now() >= deadline) break
    await sleep(LISTEN_POLL_MS)
  }
  throw new Error(
    `agent37 instance ${args.instanceId} daemon did not answer version ${
      args.want.version
    } on port ${DAEMON_PORT} within ${Math.floor(
      budgetMs / 1000,
    )}s; last version "${running ?? 'none'}"`,
  )
}
