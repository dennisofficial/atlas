import { describe, expect, it } from 'bun:test'
import { useTestDatabase } from '../testing'

type IndexRow = { indexname: string }

describe('SessionPullRequest indexes', () => {
  const testDb = useTestDatabase()

  it('serves sessionId lookups from the primary key without a separate index', async () => {
    const { pool } = testDb()
    const result = await pool.query<IndexRow>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'SessionPullRequest' ORDER BY indexname`,
    )
    expect(result.rows.map((row) => row.indexname)).toEqual([
      'V2SessionPullRequest_pkey',
      'V2SessionPullRequest_repoFullName_prNumber_idx_af81cccf',
    ])
  })
})
