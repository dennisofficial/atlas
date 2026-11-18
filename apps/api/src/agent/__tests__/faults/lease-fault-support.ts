import { join } from 'node:path'

import pg from 'pg'

import type { ScriptedModelStep } from '@dltech/atlas-agent/testing'

import type { FaultRig, HostProcess, ReadEvent, RigDaemon } from '../../testing/fault-rig'
import { HOST_WATCH_APPLICATION_NAME } from '../../presence/pg-host-watch'
import { makeFifo } from './fault-support'

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

export const waitUntil = async (args: {
  what: string
  timeoutMs: number
  check(): Promise<boolean>
}): Promise<void> => {
  const deadline = Date.now() + args.timeoutMs
  while (!(await args.check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${args.what}`)
    await sleep(100)
  }
}

export const waitForLog = async (args: {
  host: HostProcess
  text: string
  timeoutMs: number
}): Promise<void> => {
  await waitUntil({
    what: `"${args.text}" in the logs of ${args.host.label}:\n${args.host.logs().join('\n')}`,
    timeoutMs: args.timeoutMs,
    check: async () => args.host.logs().some((line) => line.includes(args.text)),
  })
}

export type GatedSession = {
  sessionId: string
  daemon: RigDaemon
  startedFile: string
  gateFifo: string
  runsFile: string
  command: string
}

export const prepareGated = async (args: {
  rig: FaultRig
  sessionId: string
}): Promise<GatedSession> => {
  const { sessionId } = args
  const daemon = await args.rig.spawnDaemonFor({ sessionId })
  const startedFile = join(daemon.home, `started-${sessionId}`)
  const gateFifo = join(daemon.home, `gate-${sessionId}`)
  const runsFile = join(daemon.home, `runs-${sessionId}`)
  makeFifo({ path: gateFifo })
  const command = `touch ${startedFile}; echo run >> ${runsFile}; cat ${gateFifo}; echo done`
  return { sessionId, daemon, startedFile, gateFifo, runsFile, command }
}

const LATER_GENERATIONS = [2, 3, 4, 5, 6]

export const laterScripts = (args: {
  sessionId: string
  final: string
}): Record<string, ScriptedModelStep[]> =>
  Object.fromEntries(
    LATER_GENERATIONS.map((generation) => [
      `${args.sessionId}@${generation}`,
      [{ text: args.final }],
    ]),
  )

export const holderScripts = (args: {
  gated: GatedSession
  final: string
}): Record<string, ScriptedModelStep[]> => ({
  [args.gated.sessionId]: [
    {
      calls: [
        {
          callId: 'c1',
          name: 'bash',
          input: { description: 'gated', command: args.gated.command },
        },
      ],
    },
    { text: args.final },
  ],
  ...laterScripts({ sessionId: args.gated.sessionId, final: args.final }),
})

export const textScripts = (args: {
  sessionIds: readonly string[]
  final: string
}): Record<string, ScriptedModelStep[]> =>
  Object.fromEntries(args.sessionIds.map((id) => [id, [{ text: args.final }]]))

export const watchersWaiting = async (args: {
  url: string
  ignoreWaitingOnHostId?: number
}): Promise<number> => {
  const client = new pg.Client(args.url)
  await client.connect()
  try {
    const { rows } = await client.query<{ count: string }>(
      `SELECT count(*) FROM pg_stat_activity a
         WHERE a.application_name = $1 AND a.datname = current_database() AND a.state = 'active' AND a.wait_event_type = 'Lock'
           AND NOT EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid = a.pid AND NOT l.granted
             AND l.locktype = 'advisory' AND l.objid = $2::oid)`,
      [HOST_WATCH_APPLICATION_NAME, args.ignoreWaitingOnHostId ?? -1],
    )
    return Number(rows[0]?.count)
  } finally {
    await client.end()
  }
}

export const hostIdsByLabel = async (args: { url: string }): Promise<Record<string, number>> => {
  const client = new pg.Client(args.url)
  await client.connect()
  try {
    const { rows } = await client.query<{ id: number; label: string }>(
      'SELECT id, label FROM "v2"."V2Host" ORDER BY id',
    )
    return Object.fromEntries(rows.map((row) => [row.label, row.id]))
  } finally {
    await client.end()
  }
}

export const terminateAllBackends = async (args: { url: string }): Promise<number> => {
  const killer = new pg.Client(args.url)
  await killer.connect()
  try {
    const result = await killer.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = current_database() AND pid <> pg_backend_pid()`,
    )
    return result.rowCount ?? 0
  } finally {
    await killer.end().catch(() => undefined)
  }
}

export const waitReheld = async (args: {
  rig: FaultRig
  sessionId: string
  afterEpoch: number
  timeoutMs: number
}): Promise<{ label: string; epoch: number }> => {
  let held: { label: string; epoch: number } | undefined
  await waitUntil({
    what: `${args.sessionId} to be held again after epoch ${args.afterEpoch}`,
    timeoutMs: args.timeoutMs,
    check: async () => {
      const current = await args.rig.plane.currentLease({ sessionId: args.sessionId })
      if (!current.live || current.lease.epoch <= args.afterEpoch) return false
      const label = await args.rig.labelOf(current.lease.holderHostId)
      if (label === undefined) return false
      held = { label, epoch: current.lease.epoch }
      return true
    },
  })
  if (held === undefined) throw new Error('unreachable')
  return held
}

export const epochOf = (row: ReadEvent): number => (row.event as { epoch?: number }).epoch ?? 0

export const lateWritesAt = (args: {
  events: readonly ReadEvent[]
  epoch: number
}): ReadEvent[] => {
  const successorSeqs = args.events.filter((row) => epochOf(row) > args.epoch).map((row) => row.seq)
  if (successorSeqs.length === 0) return []
  const first = Math.min(...successorSeqs)
  return args.events.filter((row) => epochOf(row) === args.epoch && row.seq > first)
}
