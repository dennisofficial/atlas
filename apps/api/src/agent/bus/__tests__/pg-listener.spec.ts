import { afterAll, describe, expect, it } from 'bun:test'
import pg from 'pg'

import { LogPort, type LogEntry } from '@dltech/atlas-observability'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import {
  PG_CHANGE_CHANNEL,
  PG_HOST_CHANGE_CHANNEL,
  PG_WAKE_CHANNEL,
  type SessionChange,
} from '@dltech/atlas-protocol'

import { startPgChangeFeed } from '../pg-change-feed'
import { startPgListener } from '../pg-listener'

const testDb = useTestDatabase()

class RecordingLog extends LogPort {
  readonly entries: LogEntry[] = []

  record(entry: LogEntry): void {
    this.entries.push(entry)
  }
}

const waitFor = async (args: { check: () => boolean; timeoutMs?: number }): Promise<boolean> => {
  const deadline = Date.now() + (args.timeoutMs ?? 10_000)
  while (Date.now() < deadline) {
    if (args.check()) return true
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return args.check()
}

describe('pg listener', () => {
  const closers: (() => Promise<void>)[] = []
  const clients: pg.Client[] = []

  afterAll(async () => {
    for (const close of closers.splice(0)) await close()
    for (const client of clients.splice(0)) await client.end().catch(() => undefined)
  })

  const sender = async (): Promise<pg.Client> => {
    const client = new pg.Client(testDb().url)
    clients.push(client)
    await client.connect()
    return client
  }

  const terminate = async (applicationName: string): Promise<void> => {
    const killer = await sender()
    const { rows } = await killer.query<{ pid: number }>(
      `SELECT pid FROM pg_stat_activity WHERE application_name = $1`,
      [applicationName],
    )
    const target = rows[0]
    if (target === undefined) throw new Error('listener backend not found')
    await killer.query('SELECT pg_terminate_backend($1)', [target.pid])
  }

  it('routes two channels to their own handlers', async () => {
    const listener = startPgListener({
      url: testDb().url,
      channels: [PG_WAKE_CHANNEL, PG_CHANGE_CHANNEL],
    })
    closers.push(() => listener.close())
    const wakes: string[] = []
    const changes: string[] = []
    let connects = 0
    listener.on(PG_WAKE_CHANNEL, (payload) => wakes.push(payload))
    listener.on(PG_CHANGE_CHANNEL, (payload) => changes.push(payload))
    listener.onReconnect(() => {
      connects += 1
    })
    const client = await sender()
    expect(await waitFor({ check: () => connects === 1 })).toBe(true)

    await client.query(`SELECT pg_notify('${PG_WAKE_CHANNEL}', 'w1')`)
    await client.query(`SELECT pg_notify('${PG_CHANGE_CHANNEL}', 'c1')`)
    await client.query(`SELECT pg_notify('${PG_HOST_CHANGE_CHANNEL}', 'ignored')`)
    expect(await waitFor({ check: () => wakes.length === 1 && changes.length === 1 })).toBe(true)
    expect(wakes).toEqual(['w1'])
    expect(changes).toEqual(['c1'])
  }, 30_000)

  it('an unsubscribed channel handler is not called again', async () => {
    const listener = startPgListener({ url: testDb().url, channels: [PG_WAKE_CHANNEL] })
    closers.push(() => listener.close())
    const seen: string[] = []
    let connects = 0
    const off = listener.on(PG_WAKE_CHANNEL, (payload) => seen.push(payload))
    listener.onReconnect(() => {
      connects += 1
    })
    const client = await sender()
    expect(await waitFor({ check: () => connects === 1 })).toBe(true)
    await client.query(`SELECT pg_notify('${PG_WAKE_CHANNEL}', 'one')`)
    expect(await waitFor({ check: () => seen.length === 1 })).toBe(true)
    off()
    await client.query(`SELECT pg_notify('${PG_WAKE_CHANNEL}', 'two')`)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(seen).toEqual(['one'])
  }, 30_000)

  it('fires onReconnect on connect and again after pg_terminate_backend', async () => {
    const applicationName = 'pg-listener-kill-test'
    const listener = startPgListener({
      url: testDb().url,
      channels: [PG_WAKE_CHANNEL],
      applicationName,
    })
    closers.push(() => listener.close())
    const seen: string[] = []
    let connects = 0
    listener.on(PG_WAKE_CHANNEL, (payload) => seen.push(payload))
    listener.onReconnect(() => {
      connects += 1
    })
    expect(await waitFor({ check: () => connects === 1 })).toBe(true)
    await terminate(applicationName)
    expect(await waitFor({ check: () => connects >= 2, timeoutMs: 15_000 })).toBe(true)

    const client = await sender()
    await client.query(`SELECT pg_notify('${PG_WAKE_CHANNEL}', 'after-kill')`)
    expect(await waitFor({ check: () => seen.includes('after-kill') })).toBe(true)
  }, 30_000)
})

describe('pg change feed', () => {
  it('delivers parsed changes, drops a malformed payload and fires onGap on reconnect', async () => {
    const applicationName = 'pg-change-feed-test'
    const log = new RecordingLog()
    const feed = startPgChangeFeed({
      url: testDb().url,
      applicationName,
      log,
    })
    const changes: SessionChange[] = []
    let gaps = 0
    feed.onChange((change) => changes.push(change))
    feed.onGap(() => {
      gaps += 1
    })
    const client = new pg.Client(testDb().url)
    await client.connect()
    try {
      expect(await waitFor({ check: () => gaps === 1 })).toBe(true)

      await client.query(`SELECT pg_notify('${PG_CHANGE_CHANNEL}', 'not json')`)
      await client.query(`SELECT pg_notify('${PG_CHANGE_CHANNEL}', '{"sessionId":""}')`)
      await client.query(
        `SELECT pg_notify('${PG_CHANGE_CHANNEL}', '{"sessionId":"s1","threadId":"t1","headSeq":4}')`,
      )
      await client.query(`SELECT pg_notify('${PG_CHANGE_CHANNEL}', '{"sessionId":"s2"}')`)
      expect(await waitFor({ check: () => changes.length === 2 })).toBe(true)
      expect(changes).toEqual([
        { sessionId: 's1', threadId: 't1', headSeq: 4 },
        { sessionId: 's2' },
      ])
      expect(log.entries.filter((entry) => entry.message.includes('malformed'))).toHaveLength(2)

      const { rows } = await client.query<{ pid: number }>(
        `SELECT pid FROM pg_stat_activity WHERE application_name = $1`,
        [applicationName],
      )
      const target = rows[0]
      if (target === undefined) throw new Error('feed backend not found')
      await client.query('SELECT pg_terminate_backend($1)', [target.pid])
      expect(await waitFor({ check: () => gaps >= 2, timeoutMs: 15_000 })).toBe(true)
    } finally {
      await feed.close()
      await client.end().catch(() => undefined)
    }
  }, 30_000)
})
