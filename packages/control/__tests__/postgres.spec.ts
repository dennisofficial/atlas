import { afterAll, beforeAll, expect, it } from 'bun:test'
import pg from 'pg'

import { useTestDatabase } from '@dltech/atlas-db/testing'
import {
  PG_CHANGE_CHANNEL,
  PG_PRESENCE_LOCK_NAMESPACE,
  PG_WAKE_CHANNEL,
  sessionChangeSchema,
  type SessionChange,
} from '@dltech/atlas-protocol'

import {
  describeControlPlaneBlobs,
  describeControlPlaneChanges,
  describeControlPlaneClaimNext,
  describeControlPlaneClaims,
  describeControlPlaneConformance,
  describeControlPlanePresence,
  describeControlPlaneReads,
  describeControlPlaneSessions,
  describeControlPlaneWakes,
} from '../src/testing/conformance'
import { ControlPlane } from '../src/control-plane'
import { PostgresControlStore } from '../src/postgres'

const testDb = useTestDatabase()

const wakeCounts = new Map<string, number>()
const changeLog = new Map<string, SessionChange[]>()
let listener: pg.Client | undefined

beforeAll(async () => {
  listener = new pg.Client(testDb().url)
  listener.on('notification', (message) => {
    if (message.payload === undefined) return
    if (message.channel === PG_CHANGE_CHANNEL) {
      const change = sessionChangeSchema.parse(JSON.parse(message.payload))
      changeLog.set(change.sessionId, [...(changeLog.get(change.sessionId) ?? []), change])
      return
    }
    if (message.channel !== PG_WAKE_CHANNEL) return
    wakeCounts.set(message.payload, (wakeCounts.get(message.payload) ?? 0) + 1)
  })
  await listener.connect()
  await listener.query(`LISTEN ${PG_WAKE_CHANNEL}; LISTEN ${PG_CHANGE_CHANNEL}`)
})

afterAll(async () => {
  await listener?.end()
})

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 150))

const lockClients: pg.Client[] = []

afterAll(async () => {
  for (const client of lockClients.splice(0)) await client.end().catch(() => undefined)
})

const holdLock = async (args: {
  hostId: number
  fn: string
  url?: string | undefined
}): Promise<() => Promise<void>> => {
  const client = new pg.Client(args.url ?? testDb().url)
  lockClients.push(client)
  await client.connect()
  await client.query(`SELECT ${args.fn}($1, $2)`, [PG_PRESENCE_LOCK_NAMESPACE, args.hostId])
  return () => client.end()
}

let lastHostId = 0

const conformanceParams = {
  name: 'postgres',
  makeStore: () => new PostgresControlStore(testDb().db),
  reset: async () => {
    wakeCounts.clear()
    changeLog.clear()
  },
  wakes: async (sessionId: string) => {
    await settle()
    return wakeCounts.get(sessionId) ?? 0
  },
  changes: async (sessionId: string) => {
    await settle()
    return changeLog.get(sessionId) ?? []
  },
  nextHostId: async () => {
    lastHostId += 1
    return lastHostId
  },
  holdPresence: (hostId: number) => holdLock({ hostId, fn: 'pg_advisory_lock' }),
}

describeControlPlaneConformance(conformanceParams)
describeControlPlaneSessions(conformanceParams)
describeControlPlaneReads(conformanceParams)
describeControlPlaneClaims(conformanceParams)
describeControlPlaneClaimNext(conformanceParams)
describeControlPlaneBlobs(conformanceParams)
describeControlPlaneWakes(conformanceParams)
describeControlPlaneChanges(conformanceParams)

describeControlPlanePresence({
  ...conformanceParams,
  holdShared: (hostId) => holdLock({ hostId, fn: 'pg_advisory_lock_shared' }),
})

it('a presence lock held in another database of the cluster is not present here', async () => {
  const other = new URL(testDb().url)
  other.pathname = '/atlas_test'
  lastHostId += 1
  const hostId = lastHostId
  const release = await holdLock({ hostId, fn: 'pg_advisory_lock', url: other.toString() })
  try {
    const plane = new ControlPlane({ store: new PostgresControlStore(testDb().db) })
    expect(await plane.hostPresent({ hostId })).toBe(false)
  } finally {
    await release()
  }
})
