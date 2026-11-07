import { afterAll, expect, it } from 'bun:test'
import pg from 'pg'

import { useTestDatabase } from '@dltech/atlas-db/testing'
import { PG_PRESENCE_LOCK_NAMESPACE } from '@dltech/atlas-protocol'

import { ControlPlane } from '../src/control-plane'
import type { ControlTx } from '../src/port'
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

class GatedStore extends PostgresControlStore {
  onLeaseShared: (() => Promise<void>) | undefined

  override transact<T>(work: (tx: ControlTx) => Promise<T>): Promise<T> {
    return super.transact((tx) =>
      work(
        new Proxy(tx, {
          get: (target, key, receiver) => {
            if (key !== 'shareLease') return Reflect.get(target, key, receiver)
            return async (sessionId: string) => {
              const lease = await target.shareLease(sessionId)
              await this.onLeaseShared?.()
              return lease
            }
          },
        }),
      ),
    )
  }
}

it('postgres: an in-flight append holds the lease FOR SHARE, so claimNext skips the row and the next append is stale-epoch', async () => {
  const { db } = testDb()
  const plane = new ControlPlane({ store: new PostgresControlStore(db) })
  const gated = new GatedStore(db)
  const appender = new ControlPlane({ store: gated })
  await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }))
  const { epoch } = await plane.grant({ sessionId: SESSION, hostId: 101 })
  await holdPresence(102)

  let shared!: () => void
  let release!: () => void
  const isShared = new Promise<void>((resolve) => (shared = resolve))
  const gate = new Promise<void>((resolve) => (release = resolve))
  gated.onLeaseShared = async () => {
    shared()
    await gate
  }
  const appending = appender.append({
    threadId: THREAD,
    epoch,
    events: mint({ bodies: [said('in flight')], epoch }),
  })
  await isShared

  expect((await plane.claimNext({ hostId: 102, limit: 5 })).leases).toEqual([])

  release()
  expect(await appending).toMatchObject({ ok: true })
  const claimed = (await plane.claimNext({ hostId: 102, limit: 5 })).leases
  expect(claimed).toMatchObject([{ epoch: epoch + 1, holderHostId: 102 }])

  gated.onLeaseShared = undefined
  const head = await plane.head({ threadId: THREAD })
  const late = await appender.append({
    threadId: THREAD,
    epoch,
    events: mint({ bodies: [said('late')], epoch, from: head }),
  })
  expect(late).toMatchObject({ ok: false, refusal: { kind: 'stale-epoch', current: epoch + 1 } })
})
