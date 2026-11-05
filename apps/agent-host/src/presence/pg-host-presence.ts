import pg from 'pg'

import type { HostPresence } from '@dltech/atlas-host'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'
import { PG_HOST_CHANGE_CHANNEL, PG_PRESENCE_LOCK_NAMESPACE } from '@dltech/atlas-protocol'

export class PooledPresenceUrlError extends Error {
  constructor() {
    super('presence needs a direct Postgres connection; got a pooler')
    this.name = 'PooledPresenceUrlError'
  }
}

export type PgPresenceClient = {
  connect(): Promise<unknown>
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
  end(): Promise<void>
  on(event: 'error', listener: (error: unknown) => void): void
  on(event: 'end', listener: () => void): void
}

export class PresenceLostDuringRegisterError extends Error {
  constructor() {
    super('the presence connection was lost while registering')
    this.name = 'PresenceLostDuringRegisterError'
  }
}

export const PRESENCE_APPLICATION_NAME = 'atlas-host-presence'

export const PRESENCE_CONNECT_TIMEOUT_MS = 5_000

const SESSION_SETTINGS = [
  'SET statement_timeout = 0',
  'SET idle_session_timeout = 0',
  'SET idle_in_transaction_session_timeout = 0',
]

export const newPresenceClient = (url: string): pg.Client =>
  new pg.Client({
    connectionString: url,
    keepAlive: true,
    connectionTimeoutMillis: PRESENCE_CONNECT_TIMEOUT_MS,
    application_name: PRESENCE_APPLICATION_NAME,
  })

const firstValue = (result: { rows: Record<string, unknown>[] }, column: string): unknown =>
  result.rows[0]?.[column]

export const createPgHostPresence = (args: {
  url: string
  label: string
  createClient?: (() => PgPresenceClient) | undefined
  log?: LogPort | undefined
}): HostPresence => {
  const live = new Map<number, PgPresenceClient>()
  const listeners = new Set<(hostId: number) => void>()

  const handleLost = (params: { hostId: number; client: PgPresenceClient; error?: unknown }) => {
    if (live.get(params.hostId) !== params.client) return
    live.delete(params.hostId)
    args.log?.error({
      source: 'presence',
      message: 'presence connection lost',
      data: { hostId: params.hostId },
      ...(params.error === undefined ? {} : logFieldsOf({ error: params.error })),
    })
    void params.client.end().catch(() => undefined)
    for (const listener of [...listeners]) listener(params.hostId)
  }

  const open = async (client: PgPresenceClient): Promise<void> => {
    await client.connect()
    for (const statement of SESSION_SETTINGS) await client.query(statement)
    const port = await client.query('SELECT inet_server_port() AS "port"')
    if (firstValue(port, 'port') === null) throw new PooledPresenceUrlError()
  }

  const claim = async (client: PgPresenceClient): Promise<number> => {
    const next = await client.query(
      `SELECT nextval(pg_get_serial_sequence('"v2"."V2Host"', 'id')) AS "id"`,
    )
    const hostId = Number(firstValue(next, 'id'))
    const locked = await client.query('SELECT pg_try_advisory_lock($1::int, $2::int) AS "locked"', [
      PG_PRESENCE_LOCK_NAMESPACE,
      hostId,
    ])
    if (firstValue(locked, 'locked') !== true) {
      throw new Error(`presence lock for host ${hostId} is already held`)
    }
    await client.query(
      'INSERT INTO "v2"."V2Host" (id, label, "startedAt") VALUES ($1, $2, now())',
      [hostId, args.label],
    )
    await client.query('SELECT pg_notify($1, $2)', [PG_HOST_CHANGE_CHANNEL, String(hostId)])
    return hostId
  }

  return {
    async register() {
      const client = args.createClient?.() ?? newPresenceClient(args.url)
      let hostId: number | undefined
      let lostWhileRegistering = false
      const handleClientGone = (error?: unknown): void => {
        if (hostId === undefined) {
          lostWhileRegistering = true
          return
        }
        handleLost({ hostId, client, error })
      }
      client.on('error', (error: unknown) => handleClientGone(error))
      client.on('end', () => handleClientGone())
      try {
        await open(client)
        const claimed = await claim(client)
        if (lostWhileRegistering) throw new PresenceLostDuringRegisterError()
        live.set(claimed, client)
        hostId = claimed
        return claimed
      } catch (error) {
        await client.end().catch(() => undefined)
        throw error
      }
    },

    onLost(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    async abandon(hostId) {
      const client = live.get(hostId)
      if (client === undefined) return
      await client.end().catch(() => undefined)
      handleLost({ hostId, client })
    },

    async close() {
      const closing = [...live]
      live.clear()
      for (const [hostId, client] of closing) {
        await client
          .query('DELETE FROM "v2"."V2Host" WHERE id = $1', [hostId])
          .then(() =>
            client.query('SELECT pg_notify($1, $2)', [PG_HOST_CHANGE_CHANNEL, String(hostId)]),
          )
          .catch(() => undefined)
        await client.end().catch(() => undefined)
      }
    },
  }
}
