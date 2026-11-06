import { afterAll, expect, it } from 'bun:test'
import pg from 'pg'

import { useTestDatabase } from '@dltech/atlas-db/testing'
import { PG_PRESENCE_LOCK_NAMESPACE } from '@dltech/atlas-protocol'

import { ControlPlane } from '../src/control-plane'
import { PostgresControlStore } from '../src/postgres'
import { createSessionParams } from '../src/testing/conformance/support'

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

const CALL_BOUND_MS = 5000
const SESSIONS = 400
const ROUNDS = 100
const PER_CALL = 2

const bounded = <T>(work: Promise<T>): Promise<T> =>
  Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('claimNext blocked')), CALL_BOUND_MS),
    ),
  ])

it('postgres: two hosts calling claimNext concurrently never claim a session twice or block', async () => {
  const plane = new ControlPlane({ store: new PostgresControlStore(testDb().db) })
  const hostA = 501
  const hostB = 502
  await holdPresence(hostA)
  await holdPresence(hostB)
  for (let index = 0; index < SESSIONS; index += 1) {
    await plane.createSession(
      createSessionParams({ sessionId: `cn-${index}`, mainThreadId: `cn-thread-${index}` }),
    )
  }
  const claimed = new Map<string, number>()
  for (let round = 0; round < ROUNDS; round += 1) {
    const [fromA, fromB] = await Promise.all([
      bounded(plane.claimNext({ hostId: hostA, limit: PER_CALL })),
      bounded(plane.claimNext({ hostId: hostB, limit: PER_CALL })),
    ])
    for (const lease of [...fromA.leases, ...fromB.leases]) {
      claimed.set(lease.sessionId, (claimed.get(lease.sessionId) ?? 0) + 1)
    }
  }
  expect(claimed.size).toBeGreaterThan(0)
  expect([...claimed.values()].every((count) => count === 1)).toBe(true)
  for (const sessionId of claimed.keys()) {
    const { lease } = await plane.currentLease({ sessionId })
    expect(lease.epoch).toBe(1)
    expect(lease.holderHostId === hostA || lease.holderHostId === hostB).toBe(true)
  }
  const rest = await plane.claimNext({ hostId: hostA, limit: SESSIONS })
  expect(claimed.size + rest.leases.length).toBe(SESSIONS)
}, 120_000)
