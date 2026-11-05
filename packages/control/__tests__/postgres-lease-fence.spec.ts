import { afterAll, expect, it } from 'bun:test'
import pg from 'pg'

import { useTestDatabase } from '@dltech/atlas-db/testing'
import { PG_PRESENCE_LOCK_NAMESPACE } from '@dltech/atlas-protocol'

import { ControlPlane } from '../src/control-plane'
import { PostgresControlStore } from '../src/postgres'
import {
  createSessionParams,
  mint,
  said,
  SESSION,
  THREAD,
} from '../src/testing/conformance/support'

const testDb = useTestDatabase()
const clients: pg.Client[] = []

afterAll(async () => {
  for (const client of clients.splice(0)) await client.end().catch(() => undefined)
})

const holdPresence = async (hostId: number): Promise<void> => {
  const client = new pg.Client(testDb().url)
  clients.push(client)
  await client.connect()
  await client.query('SELECT pg_advisory_lock($1, $2)', [PG_PRESENCE_LOCK_NAMESPACE, hostId])
}

const pending = (promise: Promise<unknown>): Promise<boolean> =>
  Promise.race([
    promise.then(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 400)),
  ])

it('postgres: an append holding the lease row FOR SHARE delays a concurrent claim, and the next append is stale-epoch', async () => {
  const { db } = testDb()
  const plane = new ControlPlane({ store: new PostgresControlStore(db) })
  const appender = new PostgresControlStore(db)
  await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }))
  const { epoch } = await plane.grant({ sessionId: SESSION, hostId: 101 })
  await holdPresence(102)

  let locked!: () => void
  let release!: () => void
  const isLocked = new Promise<void>((resolve) => (locked = resolve))
  const gate = new Promise<void>((resolve) => (release = resolve))
  const sharing = appender.transact(async (tx) => {
    await tx.shareLease(SESSION)
    locked()
    await gate
  })
  await isLocked

  const claiming = plane.claim({ sessionId: SESSION, hostId: 102 })
  expect(await pending(claiming)).toBe(true)

  release()
  await sharing
  const claimed = await claiming
  expect(claimed).toMatchObject({ ok: true, lease: { epoch: epoch + 1, holderHostId: 102 } })

  const late = await plane.append({
    threadId: THREAD,
    epoch,
    events: mint({ bodies: [said('late')], epoch }),
  })
  expect(late).toMatchObject({ ok: false, refusal: { kind: 'stale-epoch', current: epoch + 1 } })
})
