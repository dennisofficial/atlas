import { afterEach, describe, expect, it } from 'bun:test'
import pg from 'pg'

import { useTestDatabase } from '@dltech/atlas-db/testing'
import type { HostPresence } from '@dltech/atlas-host'
import { PG_PRESENCE_LOCK_NAMESPACE } from '@dltech/atlas-protocol'

import { startPgWakeListener, type PgWakeListener } from '../../bus/pg-wake-listener'
import { createPgHostPresence } from '../pg-host-presence'
import { startHostWatch, type HostWatch } from '../pg-host-watch'

const testDb = useTestDatabase()

const WATCH_APP = 'atlas-host-watch'

const waitFor = async (args: { check: () => Promise<boolean> | boolean; timeoutMs?: number }) => {
  const deadline = Date.now() + (args.timeoutMs ?? 10_000)
  while (Date.now() < deadline) {
    if (await args.check()) return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return args.check()
}

const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('pg host watch', () => {
  const presences: HostPresence[] = []
  const watches: HostWatch[] = []
  const listeners: PgWakeListener[] = []
  const clients: pg.Client[] = []
  let rings = 0

  afterEach(async () => {
    for (const watch of watches.splice(0)) await watch.close()
    for (const listener of listeners.splice(0)) await listener.close()
    for (const presence of presences.splice(0)) await presence.close()
    for (const client of clients.splice(0)) await client.end().catch(() => undefined)
    rings = 0
    shared = undefined
  })

  let shared: pg.Client | undefined

  const sql = async (): Promise<pg.Client> => {
    if (shared !== undefined) return shared
    const client = new pg.Client(testDb().url)
    clients.push(client)
    await client.connect()
    shared = client
    return client
  }

  const host = async (label: string): Promise<{ id: number; presence: HostPresence }> => {
    const presence = createPgHostPresence({ url: testDb().url, label })
    presences.push(presence)
    return { id: await presence.register(), presence }
  }

  const startWatch = (args: { selfId: () => number | undefined }): HostWatch => {
    const listener = startPgWakeListener({ url: testDb().url })
    listeners.push(listener)
    const watch = startHostWatch({
      url: testDb().url,
      selfId: args.selfId,
      ring: () => {
        rings += 1
      },
      onHostChange: (handler) => listener.onHostChange(handler),
    })
    watches.push(watch)
    return watch
  }

  const kill = async (hostId: number): Promise<void> => {
    const killer = await sql()
    await killer.query(
      `SELECT pg_terminate_backend(pid) FROM pg_locks
       WHERE locktype = 'advisory' AND mode = 'ExclusiveLock' AND granted
         AND classid = $1::oid AND objid = $2::oid AND objsubid = 2`,
      [PG_PRESENCE_LOCK_NAMESPACE, hostId],
    )
  }

  const hostRows = async (): Promise<number[]> => {
    const { rows } = await (await sql()).query<{ id: number }>(
      'SELECT id FROM "v2"."V2Host" ORDER BY id',
    )
    return rows.map((row) => row.id)
  }

  const watchers = async (): Promise<number> => {
    const { rows } = await (await sql()).query<{ count: string }>(
      `SELECT count(*) FROM pg_stat_activity WHERE application_name = $1 AND state = 'active'
         AND wait_event_type = 'Lock'`,
      [WATCH_APP],
    )
    return Number(rows[0]?.count)
  }

  const armed = (count: number) => waitFor({ check: async () => (await watchers()) === count })

  it('rings the claim loop when a peer presence dies and deletes its row', async () => {
    const a = await host('a')
    const b = await host('b')
    startWatch({ selfId: () => a.id })
    expect(await armed(1)).toBe(true)
    rings = 0

    await kill(b.id)

    expect(await waitFor({ check: () => rings >= 1 })).toBe(true)
    expect(await hostRows()).toEqual([a.id])
    expect(await armed(0)).toBe(true)
  }, 30_000)

  it('walks the ring: B dies, then C, and the watch ends with no successor', async () => {
    const a = await host('a')
    const b = await host('b')
    const c = await host('c')
    startWatch({ selfId: () => a.id })
    expect(await armed(1)).toBe(true)
    rings = 0

    await kill(b.id)
    expect(await waitFor({ check: async () => !(await hostRows()).includes(b.id) })).toBe(true)
    expect(await waitFor({ check: () => rings >= 1 })).toBe(true)
    expect(await armed(1)).toBe(true)
    rings = 0

    await kill(c.id)
    expect(await waitFor({ check: () => rings >= 1 })).toBe(true)
    expect(await hostRows()).toEqual([a.id])
    expect(await armed(0)).toBe(true)
  }, 30_000)

  it('wraps to the lowest id when nothing is above itself', async () => {
    const a = await host('a')
    await host('b')
    const c = await host('c')
    startWatch({ selfId: () => c.id })
    expect(await armed(1)).toBe(true)
    rings = 0

    await kill(a.id)

    expect(await waitFor({ check: () => rings >= 1 })).toBe(true)
    expect(await hostRows()).not.toContain(a.id)
  }, 30_000)

  it('retargets when a host joins above it and leaves one waiter', async () => {
    await host('a')
    const b = await host('b')
    startWatch({ selfId: () => b.id })
    expect(await armed(1)).toBe(true)

    const c = await host('c')
    await settle(500)
    expect(await armed(1)).toBe(true)
    rings = 0

    await kill(c.id)

    expect(await waitFor({ check: () => rings >= 1 })).toBe(true)
    expect(await hostRows()).not.toContain(c.id)
  }, 30_000)

  it('a changed self id retargets and the old successor is no longer watched', async () => {
    const a = await host('a')
    const b = await host('b')
    const c = await host('c')
    let self: number | undefined = a.id
    const watch = startWatch({ selfId: () => self })
    expect(await armed(1)).toBe(true)

    self = c.id
    watch.recompute()
    await settle(500)
    expect(await armed(1)).toBe(true)
    await kill(b.id)
    await settle(1_000)
    expect(await hostRows()).toContain(b.id)

    await kill(a.id)
    expect(await waitFor({ check: async () => !(await hostRows()).includes(a.id) })).toBe(true)
  }, 30_000)

  it('starts no waiter without a self id', async () => {
    await host('a')
    await host('b')
    const watch = startWatch({ selfId: () => undefined })
    watch.recompute()
    await settle(500)
    expect(await watchers()).toBe(0)
  }, 30_000)

  it('reconnects after the waiter connection is killed and still notices a death', async () => {
    const a = await host('a')
    const b = await host('b')
    startWatch({ selfId: () => a.id })
    expect(await armed(1)).toBe(true)
    rings = 0

    const killer = await sql()
    await killer.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE application_name = $1 AND pid <> pg_backend_pid()`,
      [WATCH_APP],
    )
    expect(await armed(1)).toBe(true)

    await kill(b.id)
    expect(await waitFor({ check: () => rings >= 1 })).toBe(true)
  }, 30_000)

  it('starts no waiter for a lone host', async () => {
    const a = await host('a')
    startWatch({ selfId: () => a.id })
    await settle(600)
    expect(await watchers()).toBe(0)
    const { rows } = await (await sql()).query(
      'SELECT 1 FROM pg_stat_activity WHERE application_name = $1',
      [WATCH_APP],
    )
    expect(rows).toEqual([])
  }, 30_000)

  it('close ends the waiter', async () => {
    const a = await host('a')
    await host('b')
    const watch = startWatch({ selfId: () => a.id })
    expect(await armed(1)).toBe(true)
    await watch.close()
    expect(await armed(0)).toBe(true)
  }, 30_000)
})
