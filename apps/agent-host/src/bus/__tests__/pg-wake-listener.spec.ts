import { afterAll, describe, expect, it } from 'bun:test'
import pg from 'pg'

import { useTestDatabase } from '@dltech/atlas-db/testing'
import { PG_WAKE_CHANNEL } from '@dltech/atlas-protocol'

import { startPgWakeListener, type PgWakeListener } from '../pg-wake-listener'

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
