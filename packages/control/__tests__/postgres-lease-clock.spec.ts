import { afterEach, describe, expect, it, setSystemTime } from 'bun:test'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { isLive } from '@dltech/atlas-core'

import { ControlPlane } from '../src/control-plane'
import { PostgresControlStore } from '../src/postgres'
import { InMemoryControlStore } from '../src/testing/memory'
import {
  createSessionParams,
  HOLDER,
  mint,
  PROJECT,
  said,
  SESSION,
  T0,
  THREAD,
  USER,
} from '../src/testing/conformance/support'

const dbClock = useTestDatabase()

afterEach(() => {
  setSystemTime()
})

describe('lease time comes from the store clock', () => {
  it('memory: stamps and expires leases from the store clock when no plane clock is injected', async () => {
    let now = T0
    const plane = new ControlPlane({ store: new InMemoryControlStore({ clock: () => now }) })
    await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }))
    const granted = await plane.grant({ sessionId: SESSION, holderId: HOLDER, ttlMs: 60_000 })
    expect(granted.renewedAt).toBe(T0)
    now = new Date(Date.parse(T0) + 60_001).toISOString()
    const current = await plane.currentLease({ sessionId: SESSION })
    expect(current.live).toBe(false)
    expect(
      isLive({ lease: current.lease, now: new Date(Date.parse(T0) + 59_999).toISOString() }),
    ).toBe(true)
    const renewed = await plane.grant({ sessionId: SESSION, holderId: 'pod-b', ttlMs: 60_000 })
    expect(renewed.renewedAt).toBe(now)
  })

  it('postgres: stamps the lease with the database clock, not the machine clock', async () => {
    const { db, pool } = dbClock()
    const plane = new ControlPlane({ store: new PostgresControlStore(db) })
    await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }))
    const dbNow = async (): Promise<Date> => {
      const plan = db.raw.sql`SELECT clock_timestamp() AS "at"`.returnsRow({
        at: db.sql.v2.V2Lease.columns.renewedAt,
      })
      const [row] = await db.query(plan.build())
      if (row === undefined) throw new Error('database returned no clock reading')
      return row.at
    }
    const before = await dbNow()
    setSystemTime(new Date(Date.parse(before.toISOString()) + 3_600_000))
    const granted = await plane.grant({ sessionId: SESSION, holderId: HOLDER, ttlMs: 60_000 })
    const stamped = Date.parse(granted.renewedAt)
    expect(Math.abs(stamped - Date.parse(before.toISOString()))).toBeLessThan(5_000)
    expect(Math.abs(stamped - Date.now())).toBeGreaterThan(3_500_000)
    const raw = await pool.query<{ renewed_at: Date }>(
      'SELECT "renewedAt" AS renewed_at FROM "v2"."V2Lease" WHERE "sessionId" = $1',
      [SESSION],
    )
    expect(Math.abs(Date.parse(raw.rows[0]?.renewed_at.toISOString() ?? '') - stamped)).toBe(0)
    const after = await dbNow()
    expect(
      Math.abs(Date.parse(after.toISOString()) - Date.parse(before.toISOString())),
    ).toBeLessThan(5_000)
  })

  it('postgres: an append blocked on the thread lock past lease expiry is refused as lease-expired', async () => {
    const { db } = dbClock()
    const plane = new ControlPlane({ store: new PostgresControlStore(db) })
    const blocker = new PostgresControlStore(db)
    await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }))
    const { epoch } = await plane.grant({ sessionId: SESSION, holderId: HOLDER, ttlMs: 200 })
    let locked!: () => void
    let release!: () => void
    const isLocked = new Promise<void>((resolve) => (locked = resolve))
    const gate = new Promise<void>((resolve) => (release = resolve))
    const blocking = blocker.transact(async (tx) => {
      await tx.lockThread(THREAD)
      locked()
      await gate
    })
    await isLocked
    const appending = plane.append({
      threadId: THREAD,
      epoch,
      events: mint({ bodies: [said('late')], epoch }),
    })
    await new Promise((resolve) => setTimeout(resolve, 500))
    release()
    const outcome = await appending
    await blocking
    expect(outcome).toMatchObject({ ok: false, refusal: { kind: 'lease-expired' } })
  })
})
