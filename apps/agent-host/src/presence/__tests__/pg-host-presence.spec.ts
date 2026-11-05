import { afterEach, describe, expect, it } from 'bun:test'
import pg from 'pg'

import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describeHostPresence } from '@dltech/atlas-host/testing'

import {
  createPgHostPresence,
  newPresenceClient,
  PooledPresenceUrlError,
  PresenceLostDuringRegisterError,
  PRESENCE_APPLICATION_NAME,
  type PgPresenceClient,
} from '../pg-host-presence'

const testDb = useTestDatabase()

const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const terminate = async (): Promise<void> => {
  const killer = new pg.Client(testDb().url)
  await killer.connect()
  try {
    await killer.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE application_name = $1 AND datname = current_database() AND pid <> pg_backend_pid()`,
      [PRESENCE_APPLICATION_NAME],
    )
  } finally {
    await killer.end()
  }
}

describeHostPresence({
  name: 'postgres',
  make: () => {
    const presence = createPgHostPresence({ url: testDb().url, label: 'spec-host' })
    return {
      presence,
      plane: new ControlPlane({ store: new PostgresControlStore(testDb().db) }),
      lose: terminate,
    }
  },
})

const pooledClient = (): PgPresenceClient & { ended: boolean } => ({
  ended: false,
  connect: () => Promise.resolve(),
  query: (text) =>
    Promise.resolve({ rows: text.includes('inet_server_port') ? [{ port: null }] : [] }),
  end() {
    this.ended = true
    return Promise.resolve()
  },
  on: () => undefined,
})

const dyingClient = (args: { event: 'error' | 'end' }): PgPresenceClient & { ended: boolean } => {
  const handlers = new Map<string, ((value?: unknown) => void)[]>()
  const emit = (event: string, value?: unknown): void => {
    for (const handler of handlers.get(event) ?? []) handler(value)
  }
  return {
    ended: false,
    connect: () => Promise.resolve(),
    query: (text) => {
      if (text.includes('inet_server_port')) return Promise.resolve({ rows: [{ port: 5432 }] })
      if (text.includes('nextval')) return Promise.resolve({ rows: [{ id: 42 }] })
      if (text.includes('pg_try_advisory_lock'))
        return Promise.resolve({ rows: [{ locked: true }] })
      if (text.includes('pg_notify')) {
        emit(args.event, args.event === 'error' ? new Error('socket closed') : undefined)
      }
      return Promise.resolve({ rows: [] })
    },
    end() {
      this.ended = true
      return Promise.resolve()
    },
    on: (event: string, listener: (value?: unknown) => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), listener])
    },
  }
}

describe('pg host presence', () => {
  const clients: pg.Client[] = []
  const created: pg.Client[] = []

  afterEach(async () => {
    for (const client of clients.splice(0)) await client.end().catch(() => undefined)
  })

  it('refuses a connection whose server port is null, as behind a pooler', async () => {
    const fake = pooledClient()
    const presence = createPgHostPresence({
      url: 'postgres://unused',
      label: 'pooled',
      createClient: () => fake,
    })
    await expect(presence.register()).rejects.toBeInstanceOf(PooledPresenceUrlError)
    expect(fake.ended).toBe(true)
  })

  for (const event of ['error', 'end'] as const) {
    it(`refuses a registration whose connection emits ${event} as the last query resolves`, async () => {
      const fake = dyingClient({ event })
      const presence = createPgHostPresence({
        url: 'postgres://unused',
        label: 'dying',
        createClient: () => fake,
      })
      const lost: number[] = []
      presence.onLost((hostId) => lost.push(hostId))
      await expect(presence.register()).rejects.toBeInstanceOf(PresenceLostDuringRegisterError)
      expect(fake.ended).toBe(true)
      expect(lost).toEqual([])
    })
  }

  it('registers a row and notifies the host change channel', async () => {
    const listener = new pg.Client(testDb().url)
    clients.push(listener)
    await listener.connect()
    await listener.query('LISTEN atlas_host_change')
    const payloads: string[] = []
    listener.on('notification', (message) => payloads.push(message.payload ?? ''))

    const presence = createPgHostPresence({ url: testDb().url, label: 'row-host' })
    const hostId = await presence.register()
    await settle(150)
    const { rows } = await listener.query<{ label: string }>(
      'SELECT label FROM "v2"."V2Host" WHERE id = $1',
      [hostId],
    )
    expect(rows).toEqual([{ label: 'row-host' }])
    expect(payloads).toEqual([String(hostId)])

    await presence.close()
    await settle(150)
    const gone = await listener.query('SELECT 1 FROM "v2"."V2Host" WHERE id = $1', [hostId])
    expect(gone.rows).toEqual([])
    expect(payloads).toEqual([String(hostId), String(hostId)])
  })

  it('never reconnects after the connection is lost', async () => {
    const presence = createPgHostPresence({
      url: testDb().url,
      label: 'no-reconnect',
      createClient: () => {
        const client = newPresenceClient(testDb().url)
        created.push(client)
        return client
      },
    })
    const lost: number[] = []
    presence.onLost((hostId) => lost.push(hostId))
    const hostId = await presence.register()
    await terminate()
    await settle(1_000)
    expect(lost).toEqual([hostId])
    expect(created).toHaveLength(1)
    await presence.close()
  })
})
