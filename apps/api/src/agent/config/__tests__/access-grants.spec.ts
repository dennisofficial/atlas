import { describe, expect, it } from 'bun:test'
import { useTestDatabase } from '@dltech/atlas-db/testing'

import { accessSourceOf } from '../access-grants'

const APPLICATION_NAME = 'atlas-access-grants-spec'
const POOL_IDLE_TIMEOUT_MS = 5_000
const PAST_IDLE_TIMEOUT_MS = POOL_IDLE_TIMEOUT_MS + 750

const lookup = { userId: 'user-1', projectId: 'project-1' }

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('accessSourceOf', () => {
  const database = useTestDatabase()

  const openConnectionCount = async (): Promise<number> => {
    const result = await database().pool.query<{ open: number }>(
      'SELECT count(*)::int AS open FROM pg_stat_activity WHERE application_name = $1 AND datname = current_database()',
      [APPLICATION_NAME],
    )
    return result.rows[0]?.open ?? 0
  }

  it(
    'keeps its connections open between turns',
    async () => {
      const url = new URL(database().url)
      url.searchParams.set('application_name', APPLICATION_NAME)
      const source = accessSourceOf({ databaseUrl: url.toString() })

      await source.read(lookup)
      const afterRead = await openConnectionCount()
      await pause(PAST_IDLE_TIMEOUT_MS)

      expect(afterRead).toBeGreaterThan(0)
      expect(await openConnectionCount()).toBe(afterRead)
    },
    { timeout: PAST_IDLE_TIMEOUT_MS + 5_000 },
  )
})
