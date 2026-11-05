import pg from 'pg'

import type { ControlPlane } from '@dltech/atlas-control'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'
import { PG_HOST_CHANGE_CHANNEL, PG_PRESENCE_LOCK_NAMESPACE } from '@dltech/atlas-protocol'

import type { PgPresenceClient } from './pg-host-presence'
import { wakeOrphans } from './wake-orphans'

export type HostWatch = {
  recompute(): void
  close(): Promise<void>
}

export const HOST_WATCH_APPLICATION_NAME = 'atlas-host-watch'

const RETRY_BASE_MS = 250
const RETRY_CAP_MS = 5_000

const SESSION_SETTINGS = ['SET statement_timeout = 0', 'SET lock_timeout = 0']

const SUCCESSOR_SQL = `SELECT id FROM "v2"."V2Host" WHERE id <> $1::int
  ORDER BY (id < $1::int), id LIMIT 1`

const newWatchClient = (url: string): pg.Client =>
  new pg.Client({
    connectionString: url,
    keepAlive: true,
    application_name: HOST_WATCH_APPLICATION_NAME,
  })

export const startHostWatch = (args: {
  url: string
  selfId(): number | undefined
  plane: Pick<ControlPlane, 'sessionsNeedingHolder' | 'wake'>
  onHostChange(listener: () => void): () => void
  createClient?: (() => PgPresenceClient) | undefined
  log?: LogPort | undefined
}): HostWatch => {
  let generation = 0
  let closed = false
  let client: PgPresenceClient | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let failures = 0
  let scanPending = false
  const pids = new WeakMap<PgPresenceClient, number>()

  const logError = (message: string, error: unknown): void => {
    args.log?.error({ source: 'host-watch', message, ...logFieldsOf({ error }) })
  }

  const terminateBackend = async (pid: number): Promise<void> => {
    const killer = newWatchClient(args.url)
    killer.on('error', () => undefined)
    try {
      await killer.connect()
      await killer.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
         WHERE pid = $1 AND application_name = $2`,
        [pid, HOST_WATCH_APPLICATION_NAME],
      )
    } catch (error) {
      logError('terminating the host watch backend failed', error)
    } finally {
      await killer.end().catch(() => undefined)
    }
  }

  const endClient = async (target: PgPresenceClient | undefined): Promise<void> => {
    if (target === undefined) return
    const pid = pids.get(target)
    pids.delete(target)
    if (pid !== undefined) await terminateBackend(pid)
    await target.end().catch(() => undefined)
  }

  const cancelRetry = (): void => {
    if (retryTimer === undefined) return
    clearTimeout(retryTimer)
    retryTimer = undefined
  }

  const scheduleRetry = (): void => {
    if (closed || retryTimer !== undefined) return
    const delay = Math.min(RETRY_BASE_MS * 2 ** failures, RETRY_CAP_MS)
    failures += 1
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      recompute()
    }, delay)
  }

  const fail = (params: { owner: PgPresenceClient; message: string; error?: unknown }): void => {
    if (closed || client !== params.owner) return
    client = undefined
    logError(params.message, params.error)
    void endClient(params.owner)
    scheduleRetry()
  }

  const scanOrphans = async (gen: number): Promise<boolean> => {
    if (!scanPending) return true
    try {
      await wakeOrphans({ plane: args.plane, log: args.log })
      scanPending = false
      return true
    } catch (error) {
      if (gen === generation && !closed) {
        logError('waking orphaned sessions failed', error)
        scheduleRetry()
      }
      return false
    }
  }

  const reapSuccessor = async (params: {
    owner: PgPresenceClient
    successor: number
  }): Promise<void> => {
    await params.owner.query('DELETE FROM "v2"."V2Host" WHERE id = $1', [params.successor])
    await params.owner.query('SELECT pg_notify($1, $2)', [
      PG_HOST_CHANGE_CHANNEL,
      String(params.successor),
    ])
    scanPending = true
    if (client === params.owner) client = undefined
    await endClient(params.owner)
    recompute()
  }

  const watchSuccessor = async (params: {
    owner: PgPresenceClient
    self: number
  }): Promise<void> => {
    const { owner } = params
    await owner.connect()
    for (const statement of SESSION_SETTINGS) {
      if (client !== owner) return
      await owner.query(statement)
    }
    const backend = await owner.query('SELECT pg_backend_pid() AS "pid"')
    const pid = backend.rows[0]?.pid
    if (typeof pid === 'number') pids.set(owner, pid)
    if (client !== owner) return
    const found = await owner.query(SUCCESSOR_SQL, [params.self])
    if (client !== owner) return
    const successor = found.rows[0]?.id
    if (typeof successor !== 'number') {
      client = undefined
      failures = 0
      await endClient(owner)
      return
    }
    failures = 0
    await owner.query('SELECT pg_advisory_lock_shared($1::int, $2::int)', [
      PG_PRESENCE_LOCK_NAMESPACE,
      successor,
    ])
    if (client !== owner) return
    await reapSuccessor({ owner, successor })
  }

  const run = async (params: { gen: number; ended: Promise<void> }): Promise<void> => {
    await params.ended
    if (params.gen !== generation || closed) return
    if (!(await scanOrphans(params.gen))) return
    if (params.gen !== generation || closed) return
    const self = args.selfId()
    if (self === undefined) return
    const owner = args.createClient?.() ?? newWatchClient(args.url)
    client = owner
    owner.on('error', (error: unknown) =>
      fail({ owner, message: 'host watch connection lost', error }),
    )
    owner.on('end', () => fail({ owner, message: 'host watch connection ended' }))
    try {
      await watchSuccessor({ owner, self })
    } catch (error) {
      fail({ owner, message: 'host watch failed', error })
    }
  }

  const recompute = (): void => {
    if (closed) return
    cancelRetry()
    generation += 1
    const previous = client
    client = undefined
    void run({ gen: generation, ended: endClient(previous) })
  }

  const unsubscribe = args.onHostChange(recompute)
  recompute()

  return {
    recompute,

    async close() {
      closed = true
      unsubscribe()
      cancelRetry()
      const previous = client
      client = undefined
      await endClient(previous)
    },
  }
}
