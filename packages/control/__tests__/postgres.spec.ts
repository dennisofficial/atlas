import { afterAll, beforeAll } from 'bun:test'
import pg from 'pg'

import { useTestDatabase } from '@dltech/atlas-db/testing'
import { PG_PRESENCE_LOCK_NAMESPACE, PG_WAKE_CHANNEL } from '@dltech/atlas-protocol'

import {
  describeControlPlaneBlobs,
  describeControlPlaneClaims,
  describeControlPlaneConformance,
  describeControlPlanePresence,
  describeControlPlaneSessions,
  describeControlPlaneWakes,
} from '../src/testing/conformance'
import { PostgresControlStore } from '../src/postgres'

const testDb = useTestDatabase()

const wakeCounts = new Map<string, number>()
let listener: pg.Client | undefined

beforeAll(async () => {
  listener = new pg.Client(testDb().url)
  listener.on('notification', (message) => {
    if (message.channel !== PG_WAKE_CHANNEL || message.payload === undefined) return
    wakeCounts.set(message.payload, (wakeCounts.get(message.payload) ?? 0) + 1)
  })
  await listener.connect()
  await listener.query(`LISTEN ${PG_WAKE_CHANNEL}`)
})

afterAll(async () => {
  await listener?.end()
})

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 150))

const conformanceParams = {
  name: 'postgres',
  makeStore: () => new PostgresControlStore(testDb().db),
  reset: async () => {
    wakeCounts.clear()
  },
  wakes: async (sessionId: string) => {
    await settle()
    return wakeCounts.get(sessionId) ?? 0
  },
}

describeControlPlaneConformance(conformanceParams)
describeControlPlaneSessions(conformanceParams)
describeControlPlaneClaims(conformanceParams)
describeControlPlaneBlobs(conformanceParams)
describeControlPlaneWakes(conformanceParams)

const lockClients: pg.Client[] = []

afterAll(async () => {
  for (const client of lockClients.splice(0)) await client.end().catch(() => undefined)
})

const holdLock = async (args: { hostId: number; fn: string }): Promise<() => Promise<void>> => {
  const client = new pg.Client(testDb().url)
  lockClients.push(client)
  await client.connect()
  await client.query(`SELECT ${args.fn}($1, $2)`, [PG_PRESENCE_LOCK_NAMESPACE, args.hostId])
  return () => client.end()
}

let lastHostId = 0

describeControlPlanePresence({
  ...conformanceParams,
  nextHostId: async () => {
    lastHostId += 1
    return lastHostId
  },
  holdPresence: (hostId) => holdLock({ hostId, fn: 'pg_advisory_lock' }),
  holdShared: (hostId) => holdLock({ hostId, fn: 'pg_advisory_lock_shared' }),
})
