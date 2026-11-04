import { afterAll, beforeAll } from 'bun:test'
import pg from 'pg'

import { useTestDatabase } from '@dltech/atlas-db/testing'
import { PG_WAKE_CHANNEL } from '@dltech/atlas-protocol'

import {
  describeControlPlaneBlobs,
  describeControlPlaneClaims,
  describeControlPlaneConformance,
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
