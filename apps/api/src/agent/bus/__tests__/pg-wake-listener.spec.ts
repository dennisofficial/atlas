import { afterAll, describe, expect, it } from 'bun:test'
import { EventEmitter } from 'node:events'
import pg from 'pg'

import { useTestDatabase } from '@dltech/atlas-db/testing'
import { PG_HOST_CHANGE_CHANNEL, PG_WAKE_CHANNEL } from '@dltech/atlas-protocol'

import { startPgWakeListener, type PgWakeListener } from '../pg-wake-listener'

class FakeWakeClient extends EventEmitter {
  ended = false
  private readonly holdsListen: boolean

  constructor(args: { holdsListen: boolean }) {
    super()
    this.holdsListen = args.holdsListen
  }

  connect(): Promise<void> {
    return Promise.resolve()
  }

  query(_text: string): Promise<unknown> {
    if (!this.holdsListen) return Promise.resolve({ rows: [] })
    return new Promise((_resolve, reject) => {
      this.once('error', (error: unknown) => reject(error))
    })
  }

  end(): Promise<void> {
    this.ended = true
    return Promise.resolve()
  }
}

const testDb = useTestDatabase()

const waitFor = async (args: { check: () => boolean; timeoutMs?: number }): Promise<boolean> => {
  const deadline = Date.now() + (args.timeoutMs ?? 10_000)
  while (Date.now() < deadline) {
    if (args.check()) return true
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return args.check()
}

describe('pg wake listener', () => {
  const listeners: PgWakeListener[] = []
  const clients: pg.Client[] = []

  afterAll(async () => {
    for (const listener of listeners.splice(0)) await listener.close()
    for (const client of clients.splice(0)) await client.end().catch(() => undefined)
  })

  const notifier = async (): Promise<pg.Client> => {
    const client = new pg.Client(testDb().url)
    clients.push(client)
    await client.connect()
    return client
  }

  it('a pg_notify from another connection reaches the wake handler', async () => {
    const listener = startPgWakeListener({ url: testDb().url })
    listeners.push(listener)
    const wakes: string[] = []
    const resyncs: number[] = []
    listener.onWake((sessionId) => wakes.push(sessionId))
    listener.onResync(() => resyncs.push(Date.now()))

    const sender = await notifier()
    const connected = await waitFor({ check: () => resyncs.length === 1 })
    expect(connected).toBe(true)

    await sender.query(`SELECT pg_notify('${PG_WAKE_CHANNEL}', 'session-x')`)
    const delivered = await waitFor({ check: () => wakes.length === 1 })
    expect(delivered).toBe(true)
    expect(wakes).toEqual(['session-x'])
  }, 30_000)

  it('an async error while LISTEN is pending drops the client, reconnects and resyncs', async () => {
    const created: FakeWakeClient[] = []
    const listener = startPgWakeListener({
      url: 'postgres://unused',
      createClient: () => {
        const fake = new FakeWakeClient({ holdsListen: created.length === 0 })
        created.push(fake)
        return fake
      },
    })
    listeners.push(listener)
    let resyncs = 0
    let hostChanges = 0
    listener.onResync(() => {
      resyncs += 1
    })
    listener.onHostChange(() => {
      hostChanges += 1
    })

    const first = created[0]
    if (first === undefined) throw new Error('listener created no client')
    first.emit('error', new Error('socket blew up'))

    expect(await waitFor({ check: () => created.length === 2 })).toBe(true)
    expect(first.ended).toBe(true)
    expect(await waitFor({ check: () => resyncs === 1 })).toBe(true)
    expect(hostChanges).toBe(1)
  }, 30_000)

  it('host change notifications reach onHostChange and a connect fires it once', async () => {
    const listener = startPgWakeListener({ url: testDb().url })
    listeners.push(listener)
    let changes = 0
    const wakes: string[] = []
    listener.onHostChange(() => {
      changes += 1
    })
    listener.onWake((sessionId) => wakes.push(sessionId))

    const sender = await notifier()
    expect(await waitFor({ check: () => changes === 1 })).toBe(true)

    await sender.query(`SELECT pg_notify('${PG_HOST_CHANGE_CHANNEL}', '7')`)
    expect(await waitFor({ check: () => changes === 2 })).toBe(true)
    expect(wakes).toEqual([])
  }, 30_000)

  it('an unsubscribed host change handler is not called again', async () => {
    const listener = startPgWakeListener({ url: testDb().url })
    listeners.push(listener)
    let changes = 0
    const off = listener.onHostChange(() => {
      changes += 1
    })
    const sender = await notifier()
    expect(await waitFor({ check: () => changes === 1 })).toBe(true)
    off()
    await sender.query(`SELECT pg_notify('${PG_HOST_CHANGE_CHANNEL}', '7')`)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(changes).toBe(1)
  }, 30_000)

  it('killing the listener backend reconnects and emits resync', async () => {
    const listener = startPgWakeListener({
      url: testDb().url,
      applicationName: 'wake-listener-kill-test',
    })
    listeners.push(listener)
    const wakes: string[] = []
    let resyncs = 0
    listener.onWake((sessionId) => wakes.push(sessionId))
    listener.onResync(() => {
      resyncs += 1
    })

    const killer = await notifier()
    expect(await waitFor({ check: () => resyncs === 1 })).toBe(true)

    const { rows: backends } = await killer.query<{ pid: number }>(
      `SELECT pid FROM pg_stat_activity WHERE application_name = 'wake-listener-kill-test'`,
    )
    const target = backends[0]
    if (target === undefined) throw new Error('listener backend not found')
    await killer.query('SELECT pg_terminate_backend($1)', [target.pid])

    const resynced = await waitFor({ check: () => resyncs >= 2, timeoutMs: 15_000 })
    expect(resynced).toBe(true)

    const sender = await notifier()
    await sender.query(`SELECT pg_notify('${PG_WAKE_CHANNEL}', 'session-after-kill')`)
    const delivered = await waitFor({ check: () => wakes.includes('session-after-kill') })
    expect(delivered).toBe(true)
  }, 30_000)
})
