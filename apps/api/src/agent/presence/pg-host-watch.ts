import pg from 'pg'

import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'
import { PG_HOST_CHANGE_CHANNEL, PG_PRESENCE_LOCK_NAMESPACE } from '@dltech/atlas-protocol'

import { PRESENCE_CONNECT_TIMEOUT_MS, type PgPresenceClient } from './pg-host-presence'

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
    connectionTimeoutMillis: PRESENCE_CONNECT_TIMEOUT_MS,
    application_name: HOST_WATCH_APPLICATION_NAME,
  })

export const startHostWatch = (args: {
  url: string
  selfId(): number | undefined
  ring(): void
  onHostChange(listener: () => void): () => void
  createClient?: (() => PgPresenceClient) | undefined
  log?: LogPort | undefined
}): HostWatch => {
  let closed = false
  let client: PgPresenceClient | undefined
  let reap: { owner: PgPresenceClient; successor: number } | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let failures = 0
  let loop: Promise<void> | undefined
  let again = false
  const pids = new WeakMap<PgPresenceClient, number>()

  const open = (): PgPresenceClient => args.createClient?.() ?? newWatchClient(args.url)

  const logError = (message: string, error: unknown): void => {
    args.log?.error({ source: 'host-watch', message, ...logFieldsOf({ error }) })
  }

  const terminateBackend = async (pid: number): Promise<void> => {
    const killer = open()
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
      void pump()
    }, delay)
  }

  const fail = (params: { owner: PgPresenceClient; message: string; error?: unknown }): void => {
    if (closed || client !== params.owner) return
    logError(params.message, params.error)
    scheduleRetry()
  }

  const handleDeath = (params: { owner: PgPresenceClient; successor: number }): void => {
    if (closed || client !== params.owner) return
    reap = params
    void pump()
  }

  const reapDead = async (params: { owner: PgPresenceClient; successor: number }) => {
    try {
      await params.owner.query('DELETE FROM "v2"."V2Host" WHERE id = $1', [params.successor])
      await params.owner.query('SELECT pg_notify($1, $2)', [
        PG_HOST_CHANGE_CHANNEL,
        String(params.successor),
      ])
    } catch (error) {
      logError('reaping a dead host failed', error)
    }
  }

  const arm = async (self: number): Promise<void> => {
    const owner = open()
    client = owner
    owner.on('error', (error: unknown) =>
      fail({ owner, message: 'host watch connection lost', error }),
    )
    owner.on('end', () => fail({ owner, message: 'host watch connection ended' }))
    try {
      await owner.connect()
      for (const statement of SESSION_SETTINGS) await owner.query(statement)
      const backend = await owner.query('SELECT pg_backend_pid() AS "pid"')
      const pid = backend.rows[0]?.pid
      if (typeof pid === 'number') pids.set(owner, pid)
      const found = await owner.query(SUCCESSOR_SQL, [self])
      const successor = found.rows[0]?.id
      failures = 0
      if (typeof successor !== 'number') {
        client = undefined
        await endClient(owner)
        return
      }
      owner
        .query('SELECT pg_advisory_lock_shared($1::int, $2::int)', [
          PG_PRESENCE_LOCK_NAMESPACE,
          successor,
        ])
        .then(
          () => handleDeath({ owner, successor }),
          (error: unknown) => fail({ owner, message: 'host watch wait failed', error }),
        )
    } catch (error) {
      fail({ owner, message: 'host watch failed', error })
    }
  }

  const step = async (): Promise<void> => {
    const pendingReap = reap
    reap = undefined
    if (pendingReap !== undefined) await reapDead(pendingReap)
    const previous = client
    client = undefined
    await endClient(previous)
    if (pendingReap !== undefined) args.ring()
    if (closed) return
    const self = args.selfId()
    if (self === undefined) return
    await arm(self)
  }

  const drain = async (): Promise<void> => {
    while (again) {
      again = false
      await step().catch((error: unknown) => logError('host watch step failed', error))
    }
    loop = undefined
  }

  const pump = (): Promise<void> => {
    again = true
    loop ??= drain()
    return loop
  }

  const recompute = (): void => {
    if (closed) return
    cancelRetry()
    void pump()
  }

  const unsubscribe = args.onHostChange(recompute)
  recompute()

  return {
    recompute,

    async close() {
      closed = true
      unsubscribe()
      cancelRetry()
      await pump()
    },
  }
}
